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
  table_no: number | string | null; // 修改為支援 number、string 或 null
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
  const [tableCount, setTableCount] = useState<number>(1);
  const [totalPoints, setTotalPoints] = useState<number>(1);
  const [isAdmin, setIsAdmin] = useState(false); // 是否為管理員
  const [currentUserTeamId, setCurrentUserTeamId] = useState<number | null>(null); // 目前使用者的隊伍ID
  const [currentContestTeamId, setCurrentContestTeamId] = useState<number | null>(null); // 目前使用者在本比賽中的contest_team_id
  const [currentUserName, setCurrentUserName] = useState<string>(''); // 目前使用者的名稱
  const [isContestCompleted, setIsContestCompleted] = useState(false); // 比賽是否已結束
  const [localStorageUser, setLocalStorageUser] = useState<any>(null); // localStorage 中的用戶資訊
  const [teamCaptains, setTeamCaptains] = useState<{[teamId: string]: string}>({})
  
  // 新增：檢查用戶是否可以操作比賽的函數
  const canUserOperateMatch = (match: MatchDetail): boolean => {
    // 管理員可以操作任何比賽
    if (isAdmin) {
      return true;
    }
    
    // 只要用戶參與此比賽（currentContestTeamId 不為 null），就可以操作任何場次
    // 不需要檢查是否為該場比賽的直接參與者，因為參賽者可以互相當裁判
    return currentContestTeamId !== null;
  };

  // 搜尋和過濾相關狀態
  const [searchKeyword, setSearchKeyword] = useState<string>(''); // 搜尋關鍵字
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null); // 選中的隊伍ID
  const [allTeams, setAllTeams] = useState<{id: number, name: string}[]>([]); // 所有隊伍列表 // 存儲隊伍ID到隊長名稱的映射
  
  // 新增：存儲每個 match_detail_id 對應的選手狀態
  const [playerStatusMap, setPlayerStatusMap] = useState<Record<number, {
    player1_status?: string,
    player2_status?: string,
    player3_status?: string,
    player4_status?: string
  }>>({});
  
  // Debug 相關狀態 - 保留但隱藏
  const [debugAssignedMatches, setDebugAssignedMatches] = useState<MatchDetail[]>([]);
  const [debugNextMatches, setDebugNextMatches] = useState<MatchDetail[]>([]);

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

  // 新增：取得選手狀態顯示的函數
  const getPlayerStatus = (match: MatchDetail, teamNumber: 1 | 2, playerIndex: number): React.ReactNode => {
    if (!match.match_detail_id || !playerStatusMap[match.match_detail_id]) {
      return null;
    }
    
    // 單打模式下，只顯示第一位選手的狀態
    if ((match.match_type === 'single' || match.match_type === '單打')) {
      // 單打每隊只顯示第一位選手的狀態
      if (playerIndex > 0) {
        return null; // 不顯示第二位選手狀態
      }
      
      // 單打下將狀態重新映射到前兩個位置
      const singlePlayerStatusKey = `player${teamNumber === 1 ? 0 : 2}_status` as keyof typeof playerStatusMap[number];
      const status = playerStatusMap[match.match_detail_id][singlePlayerStatusKey];
      
      if (!status) return null;
      
      // 根據狀態設置顏色
      let statusColor = 'text-gray-500';
      if (status === '已接受') statusColor = 'text-green-500';
      if (status === '已拒絕') statusColor = 'text-red-500';
      if (status === '考慮中') statusColor = 'text-yellow-500';
      
      return (
        <span className={`text-xs ${statusColor}`}>
          [{status}]
        </span>
      );
    } else {
      // 雙打模式，顯示所有選手狀態
      const statusKey = `player${playerIndex + (teamNumber === 1 ? 0 : 2)}_status` as keyof typeof playerStatusMap[number];
      const status = playerStatusMap[match.match_detail_id][statusKey];
      
      if (!status) return null;
      
      // 根據狀態設置顏色
      let statusColor = 'text-gray-500';
      if (status === '已接受') statusColor = 'text-green-500';
      if (status === '已拒絕') statusColor = 'text-red-500';
      if (status === '考慮中') statusColor = 'text-yellow-500';
      
      return (
        <span className={`text-xs ${statusColor}`}>
          [{status}]
        </span>
      );
    }
  };
  
  // 新增：檢查是否應該禁用約戰按鈕
  const shouldDisableChallengeButton = (match: MatchDetail): boolean => {
    if (!match.match_detail_id || !playerStatusMap[match.match_detail_id]) {
      // 沒有任何狀態紀錄，不禁用
      return false;
    }
    const statusMap = playerStatusMap[match.match_detail_id];
    // 只要有任何人「已拒絕」，不禁用
    const hasRejection = Object.values(statusMap).includes('已拒絕');
    // 只要有狀態紀錄且沒有人拒絕，就禁用
    return !hasRejection;
  };

  useEffect(() => {
    // 先獲取比賽詳情，然後再獲取比賽數據
    const fetchData = async () => {
      // 檢查用戶是否為管理員
      await checkUserRole();
      
      const fetchedTableCount = await fetchContestDetails();
      await fetchMatches(fetchedTableCount);
      await fetchAllTeams(); // 獲取所有參賽隊伍
      
      // 注意：將獲取隊長資訊移到獨立的 useEffect 中處理
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

  // 新增：專門處理隊長資訊的 useEffect
  useEffect(() => {
    // 確保有 matches 資料後才獲取隊長資訊
    if (matches && matches.length > 0) {
      console.log('matches 已更新，獲取隊長資訊');
      fetchCaptainsForAllTeams();
    }
  }, [matches]); // 依賴於 matches 的變化

  // 修改 fetchCaptainsForAllTeams 函數
  const fetchCaptainsForAllTeams = async () => {
    try {
      if (!matches || matches.length === 0) {
        console.log('沒有比賽資料，跳過獲取隊長資訊');
        return;
      }
      
      // 從所有比賽中收集所有隊伍ID
      const allTeamIds = new Set<number>();
      matches.forEach((match: MatchDetail) => {
        if (match.team1_id) allTeamIds.add(match.team1_id);
        if (match.team2_id) allTeamIds.add(match.team2_id);
      });
      
      const teamIdsArray = Array.from(allTeamIds);
      
      if (teamIdsArray.length === 0) {
        console.log('沒有有效的隊伍ID，跳過獲取隊長資訊');
        return;
      }
      
      console.log('開始查詢所有隊伍的隊長資訊，隊伍IDs:', teamIdsArray);
      
      // 直接查詢所有隊伍的隊長資訊
      const { data, error } = await supabase
        .from('contest_team_member')
        .select('contest_team_id, member_name')
        .in('contest_team_id', teamIdsArray)
        .eq('status', 'captain');
      
      if (error) {
        console.error('獲取隊長資訊錯誤:', error);
        return;
      }
      
      if (!data || data.length === 0) {
        console.log('未找到任何隊長資訊');
        return;
      }
      
      // 建立隊伍ID到隊長名稱的映射 (確保將ID轉為字符串)
      const captainsMap: {[teamId: string]: string} = {};
      data.forEach((item: {contest_team_id: number; member_name: string}) => {
        captainsMap[item.contest_team_id.toString()] = item.member_name;
      });
      
      console.log('獲取到的隊長資訊:', captainsMap);
      setTeamCaptains(captainsMap);
    } catch (err) {
      console.error('獲取隊長資訊時發生錯誤:', err);
    }
  };

  useEffect(() => {
    // 先獲取比賽詳情，然後再獲取比賽數據
    const fetchData = async () => {
      // 檢查用戶是否為管理員
      await checkUserRole();
      
      const fetchedTableCount = await fetchContestDetails();
      await fetchMatches(fetchedTableCount);
      await fetchAllTeams(); // 獲取所有參賽隊伍
      
      // 注意：將獲取隊長資訊移到獨立的 useEffect 中處理
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

  // 新增：取得選手狀態
  useEffect(() => {
    async function fetchPlayerStatus() {
      if (!matches.length) return;
      
      // 先獲取所有有效的 match_detail_id
      const matchDetailIds = matches
        .filter(match => match.match_detail_id)
        .map(match => match.match_detail_id);
        
      if (matchDetailIds.length === 0) return;
      
      // 查詢對應的狀態
      const { data, error } = await supabase
        .from('challenge_status_logs')
        .select('match_detail_id, player1_status, player2_status, player3_status, player4_status')
        .in('match_detail_id', matchDetailIds);
        
      if (error || !data) {
        console.error('獲取選手狀態失敗:', error);
        return;
      }
      
      console.log('從 challenge_status_logs 取得的數據:', data);
      
      // 將結果轉換為易於查詢的格式
      const statusMap: Record<number, any> = {};
      data.forEach(item => {
        if (item.match_detail_id) {
          statusMap[item.match_detail_id] = {
            player1_status: item.player1_status,
            player2_status: item.player2_status,
            player3_status: item.player3_status,
            player4_status: item.player4_status
          };
        }
      });
      
      setPlayerStatusMap(statusMap);
    }
    
    fetchPlayerStatus();
  }, [matches]);

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
        const username = storedUser.userName || storedUser.username || storedUser.name || '';
        setCurrentUserName(username);
        
        // 如果 localStorage 中沒有 team_name，但有 team_id，嘗試獲取球隊名稱
        if (!storedUser.team_name && storedUser.team_id) {
          try {
            const { data } = await supabase
              .from('courts')
              .select('name')
              .eq('team_id', storedUser.team_id)
              .maybeSingle();
            
            if (data?.name) {
              // 更新 localStorageUser，添加球隊名稱
              storedUser.team_name = data.name;
              // 可以選擇保存回 localStorage，但這不是必需的
              // localStorage.setItem('loginUser', JSON.stringify(storedUser));
            }
          } catch (err) {
            console.error('獲取球隊名稱失敗:', err);
          }
        }
        
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

        // 設置 total_points
        const totalPointsValue = data.total_points !== undefined && data.total_points !== null
          ? Math.max(1, data.total_points)
          : 1;
        setTotalPoints(totalPointsValue);
        console.log('設置後的 totalPoints 狀態變量:', totalPointsValue);
        
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
      
      const { data: matchData, error: matchError } = await supabase
        .from('contest_match')
        .select('match_id, team1_id, team2_id')
        .eq('contest_id', contestId);

      if (matchError) throw matchError;

      if (matchData && matchData.length > 0) {
        const { data: detailData, error: detailError } = await supabase
          .from('contest_match_detail')
          .select('match_detail_id, match_id, team1_member_ids, team2_member_ids, winner_team_id, score, sequence, match_type, table_no')
          .in('match_id', matchData.map((match: { match_id: number }) => match.match_id));

        if (detailError) throw detailError;

        const teamIds = matchData.flatMap((match: { team1_id: number; team2_id: number }) => [match.team1_id, match.team2_id]).filter(Boolean);
        
        const { data: teamData, error: teamError } = await supabase
          .from('contest_team')
          .select('contest_team_id, team_name')
          .in('contest_team_id', teamIds);

        if (teamError) throw teamError;

        const { data: memberData, error: memberError } = await supabase
          .from('contest_team_member')
          .select('contest_team_id, member_id, member_name')
          .in('contest_team_id', teamIds);

        if (memberError) throw memberError;
        
        const processedMatches = detailData.map((detail: any) => {
          const match = matchData.find((m: { match_id: number }) => m.match_id === detail.match_id);
          
          const team1 = teamData.find((t: { contest_team_id: number }) => t.contest_team_id === match?.team1_id);
          const team2 = teamData.find((t: { contest_team_id: number }) => t.contest_team_id === match?.team2_id);
          
          const winnerTeam = detail.winner_team_id 
            ? teamData.find((t: { contest_team_id: number }) => t.contest_team_id === detail.winner_team_id) 
            : null;
            
          let team1Ids: string[] = [];
          let team2Ids: string[] = [];
          
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
          
          if (team1MembersSubmitted) {
            team1Ids = typeof detail.team1_member_ids === 'string' 
              ? JSON.parse(detail.team1_member_ids) 
              : detail.team1_member_ids || [];
          }
          
          if (team2MembersSubmitted) {
            team2Ids = typeof detail.team2_member_ids === 'string' 
              ? JSON.parse(detail.team2_member_ids) 
              : detail.team2_member_ids || [];
          }
          
          const team1Members = team1MembersSubmitted ? team1Ids.map(memberId => {
            const member = memberData.find((m: { contest_team_id: number; member_id: string }) => 
              m.contest_team_id === match?.team1_id && 
              m.member_id === memberId
            );
            return member?.member_name || memberId;
          }) : [];
          
          const team2Members = team2MembersSubmitted ? team2Ids.map(memberId => {
            const member = memberData.find((m: { contest_team_id: number; member_id: string }) => 
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
            winner_team_name: winnerTeam?.team_name || ''
          };
        });

        const sortedMatches = sortMatchesByDetailId(processedMatches);
        
        // 更新 Debug 資訊 - 保留但隱藏
        const assignedMatches = sortedMatches.filter(match => match.table_no !== null);
        const nextMatches = sortedMatches.filter(match => 
          match.table_no === null && 
          match.team1_members_submitted && 
          match.team2_members_submitted
        );
        
        setDebugAssignedMatches(assignedMatches);
        setDebugNextMatches(nextMatches);
        
        await assignTableNumbers(sortedMatches, availableTables);
        setMatches(sortedMatches);
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
      const hasAnyTableAssigned = matches.some(m => m.table_no !== null && m.table_no !== 'Next');
      
      if (hasAnyTableAssigned) {
        console.log('資料庫中已有桌次分配，跳過初始分配步驟');
        return matches;
      }
      
      // 確保桌次數量至少為 1
      const tables = Math.max(1, availableTables);
      console.log('使用的桌次數量:', tables);
      
      // 找出所有符合條件的比賽
      const eligibleMatches = matches.filter(match => 
        match.match_detail_id && 
        !match.score && 
        match.team1_members_submitted && 
        match.team2_members_submitted
      ).sort((a, b) => (a.match_detail_id || 0) - (b.match_detail_id || 0));
      
      console.log('符合條件的比賽數量:', eligibleMatches.length);
      
      if (eligibleMatches.length === 0) {
        console.log('沒有符合條件的比賽，跳過桌次分配');
        return matches;
      }
      
      // 已使用的桌次集合
      const usedTables = new Set<number>();
      const tableAssignments = [];
      
      // 第一輪分配：為符合條件的比賽分配桌次（最多分配可用桌次數量）
      for (let i = 0; i < Math.min(tables, eligibleMatches.length); i++) {
        const match = eligibleMatches[i];
        // 分配桌次號碼（從1開始）
        const tableNo = i + 1;
        
        console.log(`分配桌次: ID ${match.match_detail_id}, 桌次 ${tableNo}`);
        tableAssignments.push({ matchId: match.match_detail_id, tableNo: tableNo.toString() });
        usedTables.add(tableNo);
        match.table_no = tableNo;
      }
      
      // 第二輪處理：標記最多兩場額外的比賽為 "Next"
      const nextMatchCount = Math.min(2, eligibleMatches.length - tables);
      if (nextMatchCount > 0) {
        for (let i = 0; i < nextMatchCount; i++) {
          const matchIndex = tables + i;
          if (matchIndex < eligibleMatches.length) {
            const match = eligibleMatches[matchIndex];
            console.log(`標記為 Next: ID ${match.match_detail_id}`);
            tableAssignments.push({ matchId: match.match_detail_id, tableNo: "Next" });
            match.table_no = "Next";
          }
        }
      }
      
      // 更新資料庫
      if (tableAssignments.length > 0) {
        await updateTableNumbersInDatabase(tableAssignments);
      }
      
      return matches;
    } catch (err: any) {
      console.error('桌次分配錯誤:', err);
      return matches;
    }
  };

  
  // 更新桌次到資料庫
  const updateTableNumbersInDatabase = async (tableAssignments: { matchId: number; tableNo: number | string | null }[]) => {
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

  // 獲取所有參賽隊伍
  const fetchAllTeams = async () => {
    try {
      if (!contestId) return;
      
      // 獲取所有參與此比賽的隊伍
      const { data: teamsData, error: teamsError } = await supabase
        .from('contest_team')
        .select('contest_team_id, team_name')
        .eq('contest_id', contestId);
        
      console.log('查詢參賽隊伍返回:', teamsData, teamsError);
        
      if (teamsError) {
        console.error('獲取參賽隊伍錯誤:', teamsError);
        return;
      }
      
      if (teamsData && teamsData.length > 0) {
        const formattedTeams = teamsData.map((team: any) => ({
          id: team.contest_team_id,
          name: team.team_name
        }));
        
        setAllTeams(formattedTeams);
        console.log('獲取到所有參賽隊伍:', formattedTeams);
      }
    } catch (err) {
      console.error('獲取參賽隊伍時出錯:', err);
    }
  };
  
  // 修正 filteredMatches 函數，使用簡單直接的實現方法
  const filteredMatches = matches.filter((match: MatchDetail) => {
    // 依照搜尋關鍵字過濾，確保關鍵字非空
    let keywordMatches = true;
    if (searchKeyword !== '') {
      const keyword = searchKeyword.toLowerCase();
      
      // 檢查成員名稱是否包含關鍵字，不區分隊長和普通隊員
      const team1MembersMatch = match.team1_members?.some((member: string) => {
        const isMatch = member.toLowerCase().includes(keyword);
        if (isMatch) {
          // 檢查是否是隊長，只是為了記錄日誌
          const isCaptain = match.team1_id && teamCaptains[match.team1_id.toString()] === member;
          console.log(`關鍵字 "${keyword}" 匹配到隊伍1成員: ${member}${isCaptain ? ' (隊長)' : ''}`);
        }
        return isMatch;
      }) || false;
      
      const team2MembersMatch = match.team2_members?.some((member: string) => {
        const isMatch = member.toLowerCase().includes(keyword);
        if (isMatch) {
          // 檢查是否是隊長，只是為了記錄日誌
          const isCaptain = match.team2_id && teamCaptains[match.team2_id.toString()] === member;
          console.log(`關鍵字 "${keyword}" 匹配到隊伍2成員: ${member}${isCaptain ? ' (隊長)' : ''}`);
        }
        return isMatch;
      }) || false;
      
      // 也可以選擇性地檢查隊伍名稱，如果需要的話
      const team1NameMatch = match.team1_name?.toLowerCase().includes(keyword) || false;
      const team2NameMatch = match.team2_name?.toLowerCase().includes(keyword) || false;
      
      // 總匹配結果 - 只要隊員名字匹配即可，可以選擇是否包含隊伍名稱
      keywordMatches = team1MembersMatch || team2MembersMatch;
      
      // 日誌記錄匹配結果
      if (keywordMatches) {
        console.log(`比賽 ${match.match_detail_id} 匹配關鍵字 "${keyword}":`, {
          team1MembersMatch,
          team2MembersMatch
        });
      }
    }
    
    // 依照選擇的隊伍過濾
    const teamMatches = selectedTeamId === null || 
      match.team1_id === selectedTeamId || 
      match.team2_id === selectedTeamId;
    
    return keywordMatches && teamMatches;
  });

  // handleSearchSelf 函數保持不變
  const handleSearchSelf = () => {
    // 先重置所有過濾條件
    setSelectedTeamId(null);
    
    // 獲取用戶名稱（優先使用 localStorageUser.userName，其次使用 currentUserName）
    const userName = localStorageUser?.userName || currentUserName;
    
    if (userName) {
      // 如果有用戶名稱，直接使用作為搜尋關鍵字
      console.log(`執行搜尋自己操作，設置搜尋關鍵字為: ${userName}`);
      setSearchKeyword(userName);
      return;
    }
    
    // 如果沒有用戶名稱但有隊伍 ID，嘗試使用隊伍 ID 過濾
    if (localStorageUser?.team_id) {
      console.log(`執行搜尋自己操作，設置隊伍 ID 為: ${localStorageUser.team_id}`);
      setSelectedTeamId(parseInt(localStorageUser.team_id));
      return;
    }
    
    if (currentUserTeamId) {
      console.log(`執行搜尋自己操作，設置當前比賽隊伍 ID 為: ${currentUserTeamId}`);
      setSelectedTeamId(currentUserTeamId);
      return;
    }
    
    // 如果都沒有找到相關信息，提示用戶
    console.log('搜尋自己：無法找到用戶相關信息');
    alert('無法找到您的相關信息，請手動輸入搜尋關鍵字');
  };

  // 重置搜尋和過濾條件
  const resetFilters = () => {
    setSearchKeyword('');
    setSelectedTeamId(null);
  };
  
  // 新增：處理依桌次排列按鈕點擊，導航到新頁面
  const handleSortByTable = () => {
    if (contestId) {
      // 導航到新的桌次視圖頁面
      navigate(`/contest/${contestId}/table-view`);
    }
  };

  // 直接前往約戰頁面的按鈕處理函數
  const navigateToChallenge = async (match: MatchDetail) => {
    try {

      
      // 認定是當前用戶所屬的隊伍
      const userTeamId = localStorageUser?.team_id || '';
      
      // 準備要傳送的成員信息
      let playerIds: string[] = [];
      let playerNames: string[] = [];
      
      // 解析隊伍成員 IDs 和名稱
      const team1Ids = typeof match.team1_member_ids === 'string' 
        ? JSON.parse(match.team1_member_ids) 
        : match.team1_member_ids || [];
      
      const team2Ids = typeof match.team2_member_ids === 'string' 
        ? JSON.parse(match.team2_member_ids) 
        : match.team2_member_ids || [];
      
      // 根據比賽類型選擇成員
      if (match.match_type === 'single' || match.match_type === '單打') {
        // 單打也需要傳送所有選手
        if (team1Ids.length > 0) {
          playerIds = [...playerIds, ...team1Ids];
          if (match.team1_members) {
            playerNames = [...playerNames, ...match.team1_members];
          }
        }
        if (team2Ids.length > 0) {
          playerIds = [...playerIds, ...team2Ids];
          if (match.team2_members) {
            playerNames = [...playerNames, ...match.team2_members];
          }
        }
      } else {
        // 雙打選擇所有成員
        if (team1Ids.length > 0) {
          playerIds = [...playerIds, ...team1Ids];
          if (match.team1_members) {
            playerNames = [...playerNames, ...match.team1_members];
          }
        }
        if (team2Ids.length > 0) {
          playerIds = [...playerIds, ...team2Ids];
          if (match.team2_members) {
            playerNames = [...playerNames, ...match.team2_members];
          }
        }
      }
      
      // 判斷是否有足夠成員參與約戰
      if (playerIds.length === 0) {
        console.warn('無法發起約戰，因為沒有成員 IDs');
        return;
      }
      
      // 取得正確的隊伍名稱，而不僅是隊伍 ID
      let correctTeamName = localStorageUser?.team_name || '';
      
      // 如果 localStorageUser 沒有隊伍名稱，則根據 userTeamId 取得對應的隊名
      if (!correctTeamName && userTeamId) {
        if (userTeamId === match.team1_id?.toString()) {
          correctTeamName = match.team1_name;
        } else if (userTeamId === match.team2_id?.toString()) {
          correctTeamName = match.team2_name;
        }
      }
      
      // 如果仍然找不到隊名，才使用 teamId
      correctTeamName = correctTeamName || userTeamId;
      
      // 在控制台中輸出重要資訊供調試
      console.log('約戰資訊:', {
        playerIds,
        playerNames,
        match_detail_id: match.match_detail_id.toString(),
        teamId: userTeamId,
        teamName: correctTeamName,
        matchTeam1: match.team1_name,
        matchTeam2: match.team2_name
      });
      
      // 使用 navigate 跳轉到約戰頁面，並使用 state 傳送參數
      navigate('/create-challenge', { 
        state: {
          teamId: userTeamId, 
          teamName: correctTeamName,
          playerIds: playerIds,
          playerNames: playerNames, // 增加傳送成員名稱
          matchDetailId: match.match_detail_id.toString()
        }
      });
      
    } catch (err: any) {
      console.error('導航到約戰頁面失敗:', err);
      setError(err.message);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8">
      {/* 使用者資訊區塊 - 修改樣式 */}
      <div className="p-4 bg-gray-100 flex justify-between items-center">
        <div className="text-sm text-gray-600">
          <div>比賽：{contestName}</div>
          {currentContestTeamId && (
            <div className="text-green-600">✅ 您已參與此比賽</div>
          )}
          {!currentContestTeamId && !isAdmin && (
            <div className="text-orange-600">ℹ️ 您未參與此比賽</div>
          )}
        </div>
        
        <span className="text-gray-600">
          登入者：{localStorageUser?.userName || currentUserName || '訪客'}
          {localStorageUser?.team_name ? `（${localStorageUser.team_name}隊）` : ''}
          {isAdmin && <span className="ml-2 text-blue-600 font-semibold">[管理員]</span>}
        </span>
      </div>
      
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
            {/* 比分表按鈕 - 始終顯示 */}
            <button
              onClick={navigateToResults}
              className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-md mr-2"
            >
              比分表
            </button>
            {/* 新增名單狀況按鈕 */}
            <button
              onClick={() => navigate(`/contest/${contestId}/lineup-status`)}
              className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-md mr-2"
            >
              名單狀況
            </button>
            {/* 在這裡新增依桌次排列按鈕 */}
            <button
              onClick={handleSortByTable}
              className="bg-purple-500 hover:bg-purple-600 text-white px-4 py-2 rounded-md"
            >
              依桌次
            </button>
          </div>
          
          {/* 搜尋和過濾區域 - 修改為更緊湊的橫向布局 */}
          <div className="mb-6 bg-white p-3 rounded-lg shadow-sm border">
            <div className="flex flex-wrap items-center justify-between">
              {/* 左側：標題和搜尋元素 */}
              <div className="flex items-center flex-wrap gap-3 flex-1">
                <h2 className="text-base font-semibold text-blue-800 whitespace-nowrap">搜尋和過濾:</h2>
                
                {/* 關鍵字搜尋 - 更窄 */}
                <div className="relative w-48 md:w-56">
                  <div className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none">
                    <span className="text-gray-400">🔍</span>
                  </div>
                  <input
                    type="text"
                    className="block w-full pl-8 pr-2 py-1.5 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 text-sm"
                    placeholder="搜尋隊伍或成員"
                    value={searchKeyword}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchKeyword(e.target.value)}
                  />
                </div>
                
                {/* 隊伍選擇下拉選單 - 更窄 */}
                <div className="w-40 md:w-48">
                  <select
                    className="block w-full py-1.5 px-2 border border-gray-300 bg-white rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 text-sm"
                    value={selectedTeamId === null ? '' : selectedTeamId}
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSelectedTeamId(e.target.value ? parseInt(e.target.value) : null)}
                  >
                    <option value="">所有隊伍</option>
                    {allTeams.map((team: {id: number, name: string}) => (
                      <option key={team.id} value={team.id}>{team.name}</option>
                    ))}
                  </select>
                </div>
                
                {/* 操作按鈕 - 更小巧 */}
                <div className="flex gap-2">
                  <button
                    onClick={handleSearchSelf}
                    className="bg-blue-500 hover:bg-blue-600 text-white px-3 py-1.5 rounded text-sm transition duration-200"
                    title="過濾顯示自己的隊伍"
                  >
                    搜尋自己
                  </button>
                  
                  <button
                    onClick={resetFilters}
                    className="bg-gray-200 hover:bg-gray-300 text-gray-700 px-3 py-1.5 rounded text-sm transition duration-200"
                  >
                    顯示全部
                  </button>
                </div>
              </div>
              
              {/* 右側：搜尋結果計數 */}
              <div className="text-sm text-gray-600 whitespace-nowrap">
                顯示 {filteredMatches.length} / {matches.length} 場比賽
              </div>
            </div>
          </div>
          
          {matches.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              目前沒有對戰資料
            </div>
          ) : filteredMatches.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              找不到符合條件的比賽
            </div>
          ) : (
            <div className="space-y-4">
              {filteredMatches.map((match: MatchDetail, index: number) => {
                // 出賽點循環顯示邏輯
                let point = 1;
                if (totalPoints && totalPoints > 0) {
                  for (let i = 0, group = 0; i < matches.length; i++) {
                    const m = matches[i];
                    if (i === 0 || m.team1_id !== matches[i - 1].team1_id || m.team2_id !== matches[i - 1].team2_id) {
                      group = 0;
                    }
                    if (i === index) {
                      point = (group % totalPoints) + 1;
                      break;
                    }
                    group++;
                  }
                }
                return (
                  <div key={match.match_detail_id} className="border rounded-lg p-4 bg-white shadow-sm">
                    {/* 頂部區域：出賽點和桌次 */}
                    <div className="flex justify-between items-center mb-2 border-b pb-2">
                      <div className="font-bold text-blue-800">出賽點 <span className="text-xl ml-1">{point}</span></div>
                      <div>
                        <span className="text-gray-500 text-sm">桌次：</span>
                        <span className="font-medium">{match.score ? '--' : (match.table_no ? match.table_no : '')}</span>
                      </div>
                    </div>

                    {/* 在這裡渲染比賽資訊內容，例如隊伍名稱、分數、狀態等 */}

                    <div className="flex justify-between items-center mb-4">
                      {/* 隊伍1 */}
                      <div className="text-center w-2/5">
                        <div className="font-bold text-lg">{match.team1_name}</div>
                        <div className="text-xs text-gray-400">ID: {match.team1_id}</div>
                        <div className="text-xs text-gray-500">
                          隊長: {match.team1_id && teamCaptains[match.team1_id.toString()] ? teamCaptains[match.team1_id.toString()] : '無隊長'}
                        </div>
                        <div className="text-sm mt-1 text-gray-600">
                          {getTeamMembersDisplay(match, 1)}
                          {/* 針對單打比賽，顯示人員名字底下的狀態 */}
                          {match.match_detail_id && (match.match_type === 'single' || match.match_type === '單打') && (
                            <div className="mt-1 text-xs">
                              {match.team1_members && match.team1_members.length > 0 && playerStatusMap[match.match_detail_id] && (
                                <div className="mt-0.5">{playerStatusMap[match.match_detail_id].player1_status || '未讀取'}</div>
                              )}
                            </div>
                          )}
                          {/* 保留原有的狀態顯示機制（用於雙打） */}
                          {match.match_detail_id && (match.match_type !== 'single' && match.match_type !== '單打') && (
                            <div className="mt-1">
                              {getPlayerStatus(match, 1, 1)}
                              {getPlayerStatus(match, 1, 2)}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* VS和比分區域 */}
                      <div className="text-center flex flex-col items-center">
                        <div className="font-bold text-gray-500 mb-1">vs</div>
                        {/* 比分顯示 */}
                        <div className="font-bold text-2xl flex items-center justify-center space-x-2">
                          {(() => {
                            if (!match.score) return '- : -';
                            const [raw1, raw2] = match.score.split(':');
                            const s1 = parseInt(raw1, 10);
                            const s2 = parseInt(raw2, 10);
                            if (isNaN(s1) || isNaN(s2)) return match.score;
                            if (match.winner_team_id) {
                              if (match.team1_id === match.winner_team_id) {
                                return `${Math.max(s1, s2)} : ${Math.min(s1, s2)}`;
                              } else if (match.team2_id === match.winner_team_id) {
                                return `${Math.min(s1, s2)} : ${Math.max(s1, s2)}`;
                              }
                            }
                            return `${s1} : ${s2}`;
                          })()}
                        </div>
                      </div>

                      {/* 隊伍2 */}
                      <div className="text-center w-2/5">
                        <div className="font-bold text-lg">{match.team2_name}</div>
                        <div className="text-xs text-gray-400">ID: {match.team2_id}</div>
                        <div className="text-xs text-gray-500">
                          隊長: {match.team2_id && teamCaptains[match.team2_id.toString()] ? teamCaptains[match.team2_id.toString()] : '無隊長'}
                        </div>
                        <div className="text-sm mt-1 text-gray-600">
                          {getTeamMembersDisplay(match, 2)}
                          {/* 針對單打比賽，顯示人員名字底下的狀態 */}
                          {match.match_detail_id && (match.match_type === 'single' || match.match_type === '單打') && (
                            <div className="mt-1 text-xs">
                              {match.team2_members && match.team2_members.length > 0 && playerStatusMap[match.match_detail_id] && (
                                <div className="mt-0.5">{playerStatusMap[match.match_detail_id].player2_status || '未讀取'}</div>
                              )}
                            </div>
                          )}
                          {/* 保留原有的狀態顯示機制（用於雙打） */}
                          {match.match_detail_id && (match.match_type !== 'single' && match.match_type !== '單打') && (
                            <div className="mt-1">
                              {getPlayerStatus(match, 2, 1)}
                              {getPlayerStatus(match, 2, 2)}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* 底部區域：操作按鈕 */}
                    <div className="border-t pt-2 text-center">
                      {match.score && match.winner_team_id ? (
                        <div className="flex justify-center items-center space-x-2">
                          <span className="text-green-600 font-bold">
                            {match.winner_team_name ? `${match.winner_team_name}獲勝` : '等待結果...'}
                          </span>
                          {/* 新增：比分編輯按鈕 - 僅管理員可見 */}
                          {isAdmin && (
                            <button
                              className="bg-red-500 hover:bg-red-600 text-white text-xs px-2 py-1 rounded"
                              onClick={() => {
                                // 添加詳細的調試信息
                                console.log('=== 編輯按鈕點擊調試 ===');
                                console.log('contestId:', contestId);
                                console.log('完整的 match 對象:', match);
                                console.log('match.match_detail_id:', match.match_detail_id);
                                console.log('match.team1_name:', match.team1_name);
                                console.log('match.team2_name:', match.team2_name);
                                console.log('match.score:', match.score);
                                console.log('match.winner_team_id:', match.winner_team_id);
                                
                                const stateData = {
                                  matchDetailId: match.match_detail_id,
                                  team1Name: match.team1_name,
                                  team2Name: match.team2_name,
                                  currentScore: match.score,
                                  winnerTeamId: match.winner_team_id,
                                  match: match,
                                  team1Id: match.team1_id,
                                  team2Id: match.team2_id,
                                  matchType: match.match_type
                                };
                                
                                console.log('將要傳遞的 state 數據:', stateData);
                                console.log('導航路徑:', `/contest/${contestId}/score-edit`);
                                
                                navigate(`/contest/${contestId}/score-edit`, { 
                                  state: stateData
                                });
                              }}
                              title="編輯比分"
                            >
                              編輯
                            </button>
                          )}
                        </div>
                      ) : (
                        shouldShowArrow(match) ? (
                          <div className="flex justify-center items-center space-x-2">
                            {/* 修正：前往比賽按鈕 - 根據權限控制 */}
                            <button
                              className={`px-4 py-1 rounded transition-colors ${
                                canUserOperateMatch(match)
                                  ? 'bg-blue-500 hover:bg-blue-600 text-white cursor-pointer'
                                  : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                              }`}
                              onClick={() => canUserOperateMatch(match) && navigateToGame(match)}
                              disabled={!canUserOperateMatch(match)}
                              title={
                                canUserOperateMatch(match) 
                                  ? '前往比賽' 
                                  : '您不是此場比賽的參賽者，無法操作'
                              }
                            >
                              前往比賽
                            </button>
                            
                            {/* 修正：約戰按鈕 - 根據權限控制 */}
                            <button
                              className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                                !canUserOperateMatch(match)
                                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                                  : shouldDisableChallengeButton(match) 
                                    ? 'bg-gray-400 cursor-not-allowed text-white' 
                                    : 'bg-green-500 hover:bg-green-600 text-white'
                              }`}
                              onClick={() => {
                                if (canUserOperateMatch(match) && !shouldDisableChallengeButton(match)) {
                                  navigateToChallenge(match);
                                }
                              }}
                              title={
                                !canUserOperateMatch(match)
                                  ? '您不是此場比賽的參賽者，無法發起約戰'
                                  : shouldDisableChallengeButton(match) 
                                    ? '邀請已發送，等待回應中' 
                                    : '直接發起約戰'
                              }
                              disabled={!canUserOperateMatch(match) || shouldDisableChallengeButton(match)}
                            >
                              約
                            </button>
                          </div>
                        ) : (
                          <span className="text-gray-400 italic text-sm">等待雙方提交名單</span>
                        )
                      )}
                      
                      {/* 可選：在開發模式下顯示權限檢查資訊 */}
                      {/* process.env.NODE_ENV === 'development' && (
                        <div className="mt-2 p-2 bg-gray-50 text-xs text-gray-600 rounded border">
                          <div>權限檢查: {canUserOperateMatch(match) ? '✅ 可操作' : '❌ 無權限'}</div>
                          <div>管理員: {isAdmin ? '是' : '否'}</div>
                          <div>用戶隊伍ID: {currentContestTeamId || currentUserTeamId || '無'}</div>
                          <div>比賽隊伍: {match.team1_id} vs {match.team2_id}</div>
                        </div>
                      ) */} {/* 移除 debug 視窗 */}
                    </div>
                  </div>
                );
              })}
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