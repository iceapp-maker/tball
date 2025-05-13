import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';

interface MatchDetail {
  match_detail_id: number;
  match_id: number;
  team1_member_ids: string[] | string; // 可能是字符串或字符串数组
  team2_member_ids: string[] | string;
  winner_team_id: number | null;
  score: string | null;
  sequence: number;
  match_type: 'single' | 'double' | '單打' | '雙打';
  table_no: number | null;
  team1_name: string;
  team2_name: string;
  team1_members: string[];
  team2_members: string[];
  team1_members_submitted: boolean; // 隊伍1是否已提交名單
  team2_members_submitted: boolean; // 隊伍2是否已提交名單
  winner_team_name?: string; // 新增：勝方隊伍名稱
  team1_id: number | undefined;
  team2_id: number | undefined;
}

const BattleRoomPage: React.FC = () => {
  const { contestId } = useParams<{ contestId: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [contestName, setContestName] = useState('');
  const [matches, setMatches] = useState<MatchDetail[]>([]);
  const [tableCount, setTableCount] = useState(0);
  const [isAdmin, setIsAdmin] = useState(false); // 是否為管理員
  const [currentUserTeamId, setCurrentUserTeamId] = useState<number | null>(null); // 目前使用者的隊伍ID
  const [currentContestTeamId, setCurrentContestTeamId] = useState<number | null>(null); // 目前使用者在本比賽中的contest_team_id
  const [currentUserName, setCurrentUserName] = useState<string>(''); // 目前使用者的名稱
  const [isContestCompleted, setIsContestCompleted] = useState(false); // 比賽是否已結束
  const [localStorageUser, setLocalStorageUser] = useState<any>(null); // localStorage 中的用戶資訊
  
  // 獲取顯示的隊員名稱文本
  const getTeamMembersDisplay = (match: MatchDetail, teamNumber: 1 | 2): React.ReactNode => {
    const isTeam1 = teamNumber === 1;
    const teamMembers = isTeam1 ? match.team1_members : match.team2_members;
    const membersSubmitted = isTeam1 ? match.team1_members_submitted : match.team2_members_submitted;
    const teamId = isTeam1 ? match.team1_id : match.team2_id;
    const bothSubmitted = match.team1_members_submitted && match.team2_members_submitted;
    // 管理員視同自己是每一個格子的隊伍
    const isSelfTeam = isAdmin || currentContestTeamId === teamId;

    // 狀況三：同一列都已編排人員，全部顯示選手名字
    if (bothSubmitted) {
      return teamMembers.join(', ');
    }
    // 狀況一：自己隊伍（或管理員）
    if (isSelfTeam) {
      if (membersSubmitted) {
        return teamMembers.join(', ');
      } else {
        return <span className="text-gray-400">人員名單未提</span>;
      }
    }
    // 狀況二：非自己隊伍
    if (membersSubmitted) {
      return <span className="italic">人員名單已提</span>;
    } else {
      return <span className="text-gray-400">人員名單未提</span>;
    }
  };

  // 狀況三：只有同一列都已編排人員才顯示箭頭
  const shouldShowArrow = (match: MatchDetail): boolean => {
    return match.team1_members_submitted && match.team2_members_submitted;
  };

  useEffect(() => {
    // 先獲取比賽詳情，然後再獲取比賽數據
    const fetchData = async () => {
      // 檢查用戶是否為管理員
      await checkUserRole();
      
      const fetchedTableCount = await fetchContestDetails();
      await fetchMatches(fetchedTableCount);
    };
    
    // 從 localStorage 獲取用戶資訊
    try {
      const storedUser = JSON.parse(localStorage.getItem('loginUser') || '{}');
      setLocalStorageUser(storedUser);
      
      // 如果 localStorage 中有用戶名稱但狀態中沒有，則設置之
      if (storedUser.userName && !currentUserName) {
        setCurrentUserName(storedUser.userName);
      }
      
      // 如果 localStorage 中有隊伍 ID 但狀態中沒有，則設置之
      if (storedUser.team_id && !currentUserTeamId) {
        setCurrentUserTeamId(storedUser.team_id);
      }
      
      console.log('從 localStorage 獲取的用戶資訊:', storedUser);
    } catch (err) {
      console.error('解析 localStorage 用戶資訊錯誤:', err);
    }
    
    fetchData();
  }, [contestId]);

  // 檢查用戶角色和在比賽中的隊伍
  const checkUserRole = async () => {
    try {
      // 方法1: 優先從 localStorage 獲取用戶信息（與 ContestListPage 相同方式）
      const storedUser = JSON.parse(localStorage.getItem('loginUser') || '{}');
      console.log('從 localStorage 獲取的用戶信息:', storedUser);
      
      // 如果從 localStorage 獲取到用戶信息
      if (storedUser && Object.keys(storedUser).length > 0) {
        const isUserAdmin = storedUser.role === 'admin' || storedUser.is_admin === true;
        setIsAdmin(isUserAdmin);
        
        // 設置用戶名
        const username = storedUser.userName || storedUser.username || '';
        setCurrentUserName(username);
        setLocalStorageUser(storedUser);
        
        // 設置 team_id
        if (storedUser.team_id) {
          setCurrentUserTeamId(storedUser.team_id);
          
          // 查詢在此比賽中的 contest_team_id
          await fetchUserContestTeamId();
          return; // 如果從 localStorage 獲取成功，不再執行後續的 Supabase 查詢
        }
      }
      
      // 方法2: 如果 localStorage 沒有信息，則從 Supabase 獲取
      console.log('localStorage 沒有用戶信息，嘗試從 Supabase 獲取');
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      
      if (userError) {
        console.error('獲取 Supabase 用戶錯誤:', userError);
        return;
      }
      
      if (user) {
        // 查詢用戶資料
        const { data: userData, error: roleError } = await supabase
          .from('user_profiles')
          .select('is_admin, team_id, username')
          .eq('user_id', user.id)
          .single();
          
        if (roleError) {
          console.error('獲取用戶角色錯誤:', roleError);
        } else if (userData) {
          const isUserAdmin = userData.is_admin === true;
          console.log('Supabase 用戶數據:', userData);
          console.log('用戶管理員狀態:', isUserAdmin, '用戶隊伍ID:', userData.team_id);
          setIsAdmin(isUserAdmin);
          setCurrentUserName(userData.username || '');
          
          // 如果有關聯的隊伍ID，設置為當前用戶的隊伍ID
          if (userData.team_id) {
            setCurrentUserTeamId(userData.team_id);
            
            // 查詢在此比賽中的contest_team_id
            await fetchUserContestTeamId();
          }
        }
      }
    } catch (err) {
      console.error('檢查用戶角色時出錯:', err);
    }
  };
  
  // 查詢用戶在當前比賽中的contest_team_id
  const fetchUserContestTeamId = async () => {
    try {
      if (!contestId) {
        console.log('缺少contestId參數，無法查詢contest_team_id');
        return;
      }
      // 從 localStorage 取得 member_id
      const storedUser = JSON.parse(localStorage.getItem('loginUser') || '{}');
      const memberId = storedUser.member_id;
      if (!memberId) {
        console.log('localStorage 無 member_id，無法查詢 contest_team_member');
        setCurrentContestTeamId(null);
        return;
      }
      
      console.log(`嘗試通過 member_id=${memberId} 查詢 contest_id=${contestId} 的 contest_team_id...`);
      
      // 查詢 contest_team_member
      const { data: memberData, error: memberError } = await supabase
        .from('contest_team_member')
        .select('contest_team_id')
        .eq('member_id', memberId)
        .eq('contest_id', parseInt(contestId as string));
        
      if (memberError) {
        console.log('查詢 contest_team_member 表錯誤:', memberError);
        setCurrentContestTeamId(null);
        return;
      }
      
      if (memberData && memberData.length > 0) {
        console.log('找到 contest_team_id:', memberData[0].contest_team_id);
        setCurrentContestTeamId(memberData[0].contest_team_id);
      } else {
        console.log('未找到用戶在此比賽中的 contest_team_id');
        setCurrentContestTeamId(null);
      }
    } catch (err) {
      console.error('查詢contest_team_id錯誤:', err);
      setCurrentContestTeamId(null);
    }
  };

  const fetchContestDetails = async () => {
    try {
      console.log('查詢 contest 資料表，比賽 ID:', contestId);
      const { data, error } = await supabase
        .from('contest')
        .select('*')
        .eq('contest_id', contestId)
        .single();

      if (error) throw error;
      if (data) {
        console.log('查詢結果:', data);
        console.log('比賽名稱:', data.contest_name);
        console.log('桌次數量 (table_count):', data.table_count);
        
        // 確保 table_count 至少為 1
        const tableCountValue = data.table_count !== undefined && data.table_count !== null 
          ? Math.max(1, data.table_count) 
          : 1;
        
        setContestName(data.contest_name);
        setTableCount(tableCountValue);
        console.log('設置後的 tableCount 狀態變量:', tableCountValue);
        
        return tableCountValue; // 返回桌次數量，供後續使用
      }
      return 1; // 默認值
    } catch (err: any) {
      setError(err.message);
      return 1; // 錯誤時返回默認值
    }
  };

  // 檢查比賽是否已結束（所有比賽都有比分）
  const checkContestCompleted = (matches: MatchDetail[]) => {
    if (matches.length === 0) return false;
    
    // 檢查是否所有比賽都有比分
    const allMatchesHaveScore = matches.every(match => match.score !== null && match.score !== '');
    setIsContestCompleted(allMatchesHaveScore);
    return allMatchesHaveScore;
  };

  // 導航到比賽結果頁面
  const navigateToResults = () => {
    if (contestId) {
      navigate(`/contest/${contestId}/results`);
    }
  };

  const fetchMatches = async (availableTables = tableCount) => {
    setLoading(true);
    setError('');
    
    try {
      console.log('開始獲取比賽數據，可用桌次數量:', availableTables);
      
      // 1. 獲取所有比賽對戰
      const { data: matchData, error: matchError } = await supabase
        .from('contest_match')
        .select('match_id, team1_id, team2_id')
        .eq('contest_id', contestId);

      if (matchError) throw matchError;

      if (matchData && matchData.length > 0) {
        // 2. 獲取對戰詳情
        const { data: detailData, error: detailError } = await supabase
          .from('contest_match_detail')
          .select('match_detail_id, match_id, team1_member_ids, team2_member_ids, winner_team_id, score, sequence, match_type, table_no')
          .in('match_id', matchData.map(match => match.match_id));

        if (detailError) throw detailError;

        // 輸出 table_no 欄位的數據，確認是否為空
        console.log('從資料庫獲取的 table_no 值:', detailData.map(d => ({ id: d.match_detail_id, table_no: d.table_no })));

        // 3. 獲取隊伍資訊
        const teamIds = matchData.flatMap(match => [match.team1_id, match.team2_id]).filter(Boolean);
        
        const { data: teamData, error: teamError } = await supabase
          .from('contest_team')
          .select('contest_team_id, team_name')
          .in('contest_team_id', teamIds);

        if (teamError) throw teamError;

        // 4. 查詢隊員資訊
        const { data: memberData, error: memberError } = await supabase
          .from('contest_team_member')
          .select('contest_team_id, member_id, member_name')
          .in('contest_team_id', teamIds);

        if (memberError) throw memberError;
        
        // 5. 組合數據
        const processedMatches = detailData.map(detail => {
          const match = matchData.find(m => m.match_id === detail.match_id);
          
          // 獲取隊伍名稱
          const team1 = teamData.find(t => t.contest_team_id === match?.team1_id);
          const team2 = teamData.find(t => t.contest_team_id === match?.team2_id);
          
          // 如果有winner_team_id，直接查詢勝方隊伍名稱
          const winnerTeam = detail.winner_team_id 
            ? teamData.find(t => t.contest_team_id === detail.winner_team_id) 
            : null;
            
          // 解析 team1_member_ids 和 team2_member_ids
          let team1Ids: string[] = [];
          let team2Ids: string[] = [];
          
          // 檢查是否已提交名單（空陣列也視為未提交）
          const isNonEmptyArray = (arr: any) => Array.isArray(arr) && arr.length > 0;
          const isNonEmptyStringArray = (str: any) => {
            try {
              const arr = typeof str === 'string' ? JSON.parse(str) : str;
              return Array.isArray(arr) && arr.length > 0;
            } catch {
              return false;
            }
          };
          const team1MembersSubmitted = isNonEmptyArray(detail.team1_member_ids) || isNonEmptyStringArray(detail.team1_member_ids);
          const team2MembersSubmitted = isNonEmptyArray(detail.team2_member_ids) || isNonEmptyStringArray(detail.team2_member_ids);
          
          // 解析 team1_member_ids
          if (team1MembersSubmitted) {
            team1Ids = typeof detail.team1_member_ids === 'string' 
              ? JSON.parse(detail.team1_member_ids) 
              : detail.team1_member_ids || [];
          }
          
          // 解析 team2_member_ids
          if (team2MembersSubmitted) {
            team2Ids = typeof detail.team2_member_ids === 'string' 
              ? JSON.parse(detail.team2_member_ids) 
              : detail.team2_member_ids || [];
          }
          
          // 獲取隊員名稱
          const team1Members = team1MembersSubmitted ? team1Ids.map(memberId => {
            const member = memberData.find(m => 
              m.contest_team_id === match?.team1_id && 
              m.member_id === memberId
            );
            return member?.member_name || memberId;
          }) : [];
          
          const team2Members = team2MembersSubmitted ? team2Ids.map(memberId => {
            const member = memberData.find(m => 
              m.contest_team_id === match?.team2_id && 
              m.member_id === memberId
            );
            return member?.member_name || memberId;
          }) : [];
          
          return {
            ...detail,
            team1_id: match?.team1_id,
            team2_id: match?.team2_id,
            team1_name: team1?.team_name || '',
            team2_name: team2?.team_name || '',
            team1_members: team1Members,
            team2_members: team2Members,
            team1_members_submitted: team1MembersSubmitted,
            team2_members_submitted: team2MembersSubmitted,
            winner_team_name: winnerTeam?.team_name || '' // 直接保存勝方隊伍名稱
          };
        });

        // 按照 contest_match_detail 表中的 match_detail_id 順序排序
        const sortedMatches = sortMatchesByDetailId(processedMatches);
        
        // 執行桌次分配邏輯
        await assignTableNumbers(sortedMatches, availableTables);
        
        // 設置更新後的比賽數據到 matches 狀態變量
        setMatches(sortedMatches);
        
        // 檢查比賽是否已結束
        checkContestCompleted(sortedMatches);
      }
    } catch (err: any) {
      console.error('獲取比賽數據錯誤:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // 按照 contest_match_detail 表中的 match_detail_id 順序排序
  const sortMatchesByDetailId = (matches: MatchDetail[]) => {
    // 直接按照 match_detail_id 排序，確保將其轉換為數字
    return [...matches].sort((a, b) => {
      const idA = Number(a.match_detail_id);
      const idB = Number(b.match_detail_id);
      return idA - idB;
    });
  };
  
  // 桌次分配邏輯 - 根據 contest 表中的 table_count 分配桌次並保存到資料庫
  const assignTableNumbers = async (matches: MatchDetail[], availableTables: number) => {
    console.log('執行桌次分配函數，檢查是否需要分配桌次');
    
    try {
      // 檢查資料庫中是否已經有任何一個比賽被分配桌次
      // 只要有一個比賽已經分配桌次，就不再執行桌次分配
      const hasAnyTableAssigned = matches.some(m => m.table_no !== null);
      
      if (hasAnyTableAssigned) {
        console.log('資料庫中已有桌次分配，跳過初始分配步驟');
        return matches; // 直接返回現有數據，不做任何修改
      }
      
      console.log('資料庫中尚無桌次分配，進行初始分配');
      
      // 確保 availableTables 至少為 1
      const tables = Math.max(1, availableTables);
      console.log('最終使用的桌次數量:', tables);
      console.log('比賽總數:', matches.length);
      
      // 準備要更新的桌次分配
      const tableAssignments = [];
      
      // 為前 N 場比賽分配桌次，N 由 table_count 決定
      for (let i = 0; i < Math.min(matches.length, tables); i++) {
        const match = matches[i];
        const tableNo = i + 1; // 桌次從 1 開始
        console.log(`分配桌次: ID ${match.match_detail_id}, 桌次 ${tableNo}`);
        tableAssignments.push({ matchId: match.match_detail_id, tableNo });
        // 更新前端顯示的桌次
        match.table_no = tableNo;
      }
      
      // 將分配結果更新到資料庫
      if (tableAssignments.length > 0) {
        console.log(`將 ${tableAssignments.length} 個桌次分配更新到資料庫`);
        await updateTableNumbersInDatabase(tableAssignments);
      } else {
        console.log('沒有桌次需要分配');
      }
      
      return matches;
    } catch (err: any) {
      console.error('桌次分配錯誤:', err);
      return matches; // 發生錯誤時返回原始數據
    }
  };

  
  // 更新桌次到資料庫
  const updateTableNumbersInDatabase = async (tableAssignments: { matchId: number; tableNo: number | null }[]) => {
    console.log('開始更新桌次到資料庫');
    console.log('要更新的桌次分配:', tableAssignments);
    
    // 建立更新承諾數組
    const updatePromises = tableAssignments.map(({ matchId, tableNo }) => {
      console.log(`準備更新: 比賽 ID ${matchId}, 桌次 ${tableNo || 'null'}`);
      return supabase
        .from('contest_match_detail')
        .update({ table_no: tableNo })
        .eq('match_detail_id', matchId)
        .then(({ error }: { error: any }) => {
          if (error) {
            console.error(`更新比賽 ID ${matchId} 的桌次錯誤:`, error);
            throw error;
          }
          console.log(`成功更新比賽 ID ${matchId} 的桌次為 ${tableNo || 'null'}`);
          return { matchId, success: true };
        });
    });
    
    try {
      // 等待所有更新完成
      const results = await Promise.all(updatePromises);
      console.log('所有桌次更新完成:', results);
      return true;
    } catch (err: any) {
      console.error('更新桌次失敗:', err.message);
      setError(err.message);
      return false;
    }
  };

  // 更新比分
  const updateScore = async (matchDetailId: number, score: string) => {
    try {
      console.log(`更新比分: 比賽 ID ${matchDetailId}, 比分 ${score}`);
      
      // 取得目前的資料，以了解傳遞的欄位格式
      const { error: fetchError } = await supabase
        .from('contest_match_detail')
        .select('*')
        .eq('match_detail_id', matchDetailId)
        .single();
        
      if (fetchError) {
        console.error('獲取目前比賽資料錯誤:', fetchError);
        throw fetchError;
      }
      
      // 明確指定只更新 score 欄位，避免自動更新時間戳
      const { error } = await supabase
        .from('contest_match_detail')
        .update({ 
          score,
          // 如果資料庫有 updated_at 欄位，我們不更新它
          // updated_at: new Date().toISOString() 我們不適用此行，避免時間戳錯誤
        })
        .eq('match_detail_id', matchDetailId);

      if (error) {
        console.error('更新比分錯誤:', error);
        throw error;
      }
      
      console.log(`比賽 ID ${matchDetailId} 的比分已更新為 ${score}`);
      
      // 重新獲取比賽數據
      fetchMatches();
    } catch (err: any) {
      console.error('更新比分失敗:', err.message);
      setError(err.message);
    }
  };

  // 前往比賽頁面
  const navigateToGame = async (match: MatchDetail) => {
    // 準備 URL 參數
    const params = new URLSearchParams();
    
    // 添加來源標記和比賽詳情ID
    params.append('from_battleroom', 'true');
    params.append('match_detail_id', match.match_detail_id.toString());
    
    // 添加隊伍名稱
    params.append('team1_name', match.team1_name);
    params.append('team2_name', match.team2_name);
    
    // 解析 team1_member_ids 和 team2_member_ids
    const team1Ids = typeof match.team1_member_ids === 'string' 
      ? JSON.parse(match.team1_member_ids) 
      : match.team1_member_ids;
      
    const team2Ids = typeof match.team2_member_ids === 'string' 
      ? JSON.parse(match.team2_member_ids) 
      : match.team2_member_ids;
    
    // 判斷比賽類型：單打或雙打
    const isSingleMatch = (() => {
      // 首先檢查 match_type 字段，支持中文值
      if (match.match_type === 'single' || match.match_type === '單打') return true;
      if (match.match_type === 'double' || match.match_type === '雙打') return false;
      
      // 如果 match_type 不可靠，檢查成員數量
      const team1MemberCount = Array.isArray(team1Ids) ? team1Ids.length : 0;
      const team2MemberCount = Array.isArray(team2Ids) ? team2Ids.length : 0;
      
      // 如果兩隊都只有一名成員，則為單打
      if (team1MemberCount <= 1 && team2MemberCount <= 1) return true;
      
      // 如果任一隊有兩名或以上成員，則為雙打
      if (team1MemberCount >= 2 || team2MemberCount >= 2) return false;
      
      // 默認為單打
      return true;
    })();
    
    try {
      if (isSingleMatch) {
        // 單打比賽參數
        if (team1Ids[0]) {
          params.append('player1', team1Ids[0]);
          params.append('player1_name', match.team1_members[0] || '');
          params.append('player1_member_id', team1Ids[0]);
        }
        
        if (team2Ids[0]) {
          params.append('player2', team2Ids[0]);
          params.append('player2_name', match.team2_members[0] || '');
          params.append('player2_member_id', team2Ids[0]);
        }
        
        navigate(`/single_game?${params.toString()}`);
      } else {
        // 雙打比賽參數 - 確保與 NewAcceptedInvitesBlock.tsx 中的處理方式一致
        if (team1Ids.length > 0 && team1Ids[0]) {
          params.append('player1', team1Ids[0]);
          params.append('player1_name', match.team1_members[0] || '');
        }
        
        if (team1Ids.length > 1 && team1Ids[1]) {
          params.append('player2', team1Ids[1]);
          params.append('player2_name', match.team1_members[1] || '');
        }
        
        if (team2Ids.length > 0 && team2Ids[0]) {
          params.append('player3', team2Ids[0]);
          params.append('player3_name', match.team2_members[0] || '');
        }
        
        if (team2Ids.length > 1 && team2Ids[1]) {
          params.append('player4', team2Ids[1]);
          params.append('player4_name', match.team2_members[1] || '');
        }
        
        // 添加雙打頁面需要的隊伍成員和隊伍 ID 參數
        // 添加隊伍成員陳列
        params.append('team1_members', JSON.stringify(match.team1_members));
        params.append('team2_members', JSON.stringify(match.team2_members));
        
        // 添加隊伍 ID
        if (match.team1_id) {
          params.append('team1_id', match.team1_id.toString());
        }
        
        if (match.team2_id) {
          params.append('team2_id', match.team2_id.toString());
        }
        
        // 添加日誌記錄，查看傳遞到雙打頁面的參數
        console.log('雙打頁面參數:', {
          team1_member_ids: match.team1_member_ids,
          team2_member_ids: match.team2_member_ids,
          team1Ids,
          team2Ids,
          player1: params.get('player1'),
          player2: params.get('player2'),
          player3: params.get('player3'),
          player4: params.get('player4'),
          from_battleroom: params.get('from_battleroom'),
          match_detail_id: params.get('match_detail_id'),
          team1_name: params.get('team1_name'),
          team2_name: params.get('team2_name'),
          完整參數: params.toString()
        });
        
        navigate(`/double_game?${params.toString()}`);
      }
    } catch (err: any) {
      console.error('導航錯誤:', err);
      setError(err.message);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8">
      {loading ? (
        <p className="text-center">載入中...</p>
      ) : error ? (
        <p className="text-center text-red-500">{error}</p>
      ) : (
        <div>
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center">
              <button 
                onClick={() => navigate(-1)} 
                className="mr-4 bg-gray-200 hover:bg-gray-300 p-2 rounded-full"
              >
                &larr;
              </button>
              <h1 className="text-2xl font-bold">{contestName} - 戰況室</h1>
            </div>
            {/* 顯示登入者的所有資訊（用於調試） */}
            <div className="text-sm bg-gray-100 px-3 py-2 rounded shadow-md">
              <div className="font-semibold mb-1 text-blue-800">登入者資訊（調試用）</div>
              <div><b>用戶名:</b> {currentUserName || localStorageUser?.userName || '未知'}</div>
              <div><b>Contest Team ID:</b> {currentContestTeamId !== null ? currentContestTeamId : '未找到'}</div>
              <div><b>Team ID:</b> {currentUserTeamId !== null ? currentUserTeamId : (localStorageUser?.team_id || 'N/A')}</div>
              <div><b>角色:</b> {isAdmin ? '管理員' : '一般用戶'}</div>
              <div><b>URL參數:</b> contestId={contestId}</div>
              {localStorageUser && (
                <div className="mt-1 text-xs">
                  <details>
                    <summary className="cursor-pointer text-blue-600 hover:text-blue-800">從 localStorage 獲取的完整資訊</summary>
                    <div className="bg-gray-200 p-2 mt-1 rounded">
                      <pre className="whitespace-pre-wrap overflow-auto max-h-40">{JSON.stringify(localStorageUser, null, 2)}</pre>
                    </div>
                  </details>
                </div>
              )}
            </div>
            {isContestCompleted && (
              <button
                onClick={navigateToResults}
                className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-md"
              >
                名次分析
              </button>
            )}
          </div>
          {matches.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              目前沒有對戰資料
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse border border-gray-300 mb-8">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="py-3 px-4 border text-left">序號</th>
                    <th className="py-3 px-4 border text-left">隊伍1</th>
                    <th className="py-3 px-4 border text-left">隊伍2</th>
                    <th className="py-3 px-4 border text-left">比分</th>
                    <th className="py-3 px-4 border text-left">桌次</th>
                    <th className="py-3 px-4 border text-left">前往</th>
                  </tr>
                </thead>
                <tbody>
                  {matches.map((match: MatchDetail, index: number) => (
                    <tr key={match.match_detail_id} className="hover:bg-gray-50">
                      <td className="py-3 px-4 border">{index + 1}</td>
                      <td className="py-3 px-4 border">
                        <div className="font-bold mb-1">
                          {match.team1_name} 
                          <span className="text-xs text-gray-500 ml-1">(ID: {match.team1_id || 'N/A'})</span>
                        </div>
                        <div className="text-sm text-gray-600">
                          {getTeamMembersDisplay(match, 1)}
                        </div>
                      </td>
                      <td className="py-3 px-4 border" style={{ position: 'relative' }}>
                        {/* 只有在雙方名單都備齊時才顯示箭頭符號 */}
                        {shouldShowArrow(match) && (
                          <div style={{ 
                            position: 'absolute', 
                            left: '-15px', 
                            top: '50%', 
                            transform: 'translateY(-50%)',
                            fontSize: '20px',
                            color: '#666'
                          }}>
                            ➔
                          </div>
                        )}
                        <div className="font-bold mb-1">
                          {match.team2_name}
                          <span className="text-xs text-gray-500 ml-1">(ID: {match.team2_id || 'N/A'})</span>
                        </div>
                        <div className="text-sm text-gray-600">
                          {getTeamMembersDisplay(match, 2)}
                        </div>
                      </td>
                      <td className="py-3 px-4 border">{
  (() => {
    if (!match.score) return '-';
    if (!match.winner_team_id) return match.score;
    // 解析比分
    const [raw1, raw2] = match.score.split(':');
    const s1 = parseInt(raw1, 10);
    const s2 = parseInt(raw2, 10);
    if (isNaN(s1) || isNaN(s2)) return match.score;
    // 根據勝方隊伍ID決定比分順序
    if (match.team1_id === match.winner_team_id) {
      // 隊伍1獲勝，比分較高顯示在左
      return `${Math.max(s1, s2)}:${Math.min(s1, s2)}`;
    } else if (match.team2_id === match.winner_team_id) {
      // 隊伍2獲勝，比分較高顯示在右
      return `${Math.min(s1, s2)}:${Math.max(s1, s2)}`;
    } else {
      return match.score;
    }
  })()
}</td>
                    <td className="py-3 px-4 border">
  {match.score ? 
    '--' : 
    (match.table_no ? match.table_no : '')}
</td>
                      <td className="py-3 px-4 border">
                        {match.score && match.winner_team_id ? (
                          // 如果有比分且有獲勝隊伍ID，顯示獲勝隊伍名稱
                          <div className="text-green-600 font-bold">
                            {match.winner_team_name ? `${match.winner_team_name}獲勝` : '等待結果...'}
                          </div>
                        ) : (
                          // 條件4: 只有雙方都提交名單時，才顯示前往按鈕
                          shouldShowArrow(match) ? (
                            <button
                              className="bg-blue-500 hover:bg-blue-600 text-white px-2 py-1 rounded text-sm"
                              onClick={() => navigateToGame(match)}
                            >
                              →
                            </button>
                          ) : (
                            <span className="text-gray-400 italic text-xs">等待雙方提交名單</span>
                          )
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-6 p-4 bg-yellow-50 border border-yellow-200 rounded">
            <h3 className="font-bold text-yellow-800 mb-2">說明</h3>
            <ul className="list-disc pl-5 text-sm text-yellow-700">
              <li>桌次會根據可用桌數自動分配，當有比賽結束後，桌次會自動分配給下一場比賽。</li>
              <li>點擊「→」按鈕可前往比賽頁面，系統會自動排列人員。</li>
              <li>比賽結束後，比分會自動更新。</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
};



export default BattleRoomPage;