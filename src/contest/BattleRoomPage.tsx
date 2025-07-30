import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';

interface MatchDetail {
  match_detail_id: number;
  match_id: number;
  team1_member_ids: string[] | string;
  team2_member_ids: string[] | string;
  winner_team_id: number | null;
  score: string | null;
  sequence: number;
  bracket_round: number | null; // 新增：淘汰賽輪次
  match_type: 'single' | 'double' | '單打' | '雙打';
  table_no: number | string | null;
  team1_name: string;
  team2_name: string;
  team1_members: string[];
  team2_members: string[];
  team1_members_submitted: boolean;
  team2_members_submitted: boolean;
  winner_team_name?: string;
  team1_id: number | undefined;
  team2_id: number | undefined;
}

interface RoundData {
  round: number;
  matches: MatchDetail[];
  isExpanded: boolean;
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
  const [isAdmin, setIsAdmin] = useState(false);
  const [currentUserTeamId, setCurrentUserTeamId] = useState<number | null>(null);
  const [currentContestTeamId, setCurrentContestTeamId] = useState<number | null>(null);
  const [currentUserName, setCurrentUserName] = useState<string>('');
  const [isContestCompleted, setIsContestCompleted] = useState(false);
  const [localStorageUser, setLocalStorageUser] = useState<any>(null);
  const [teamCaptains, setTeamCaptains] = useState<{[teamId: string]: string}>({})
  const [matchMode, setMatchMode] = useState<string>('round_robin');
  
  // 新增：輪次相關狀態
  const [roundsData, setRoundsData] = useState<RoundData[]>([]);

  // 新增：檢查用戶是否可以操作比賽的函數
  const canUserOperateMatch = (match: MatchDetail): boolean => {
    if (isAdmin) {
      return true;
    }
    return currentContestTeamId !== null;
  };

  // 搜尋和過濾相關狀態
  const [searchKeyword, setSearchKeyword] = useState<string>('');
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const [allTeams, setAllTeams] = useState<{id: number, name: string}[]>([]);
  
  // 新增：存儲每個 match_detail_id 對應的選手狀態
  const [playerStatusMap, setPlayerStatusMap] = useState<Record<number, {
    player1_status?: string,
    player2_status?: string,
    player3_status?: string,
    player4_status?: string
  }>>({});

  // 新增：按輪次分組比賽數據 - 修正為使用 bracket_round
  const groupMatchesByRound = (matches: MatchDetail[]): RoundData[] => {
    if (matchMode === 'round_robin') {
      // 非淘汰賽模式，不分輪次，全部放在一個組中
      return [{
        round: 0,
        matches: matches,
        isExpanded: true
      }];
    }

    // 淘汰賽模式：按 bracket_round 分組
    const roundsMap = new Map<number, MatchDetail[]>();
    
    matches.forEach(match => {
      // 修正：使用 bracket_round 而不是 sequence
      const round = match.bracket_round || 1; // 如果沒有 bracket_round，默認為第1輪
      if (!roundsMap.has(round)) {
        roundsMap.set(round, []);
      }
      roundsMap.get(round)!.push(match);
    });

    // 轉換為數組並排序
    const rounds = Array.from(roundsMap.entries())
      .map(([round, matches]) => ({
        round,
        matches: matches.sort((a, b) => (a.match_detail_id || 0) - (b.match_detail_id || 0)),
        isExpanded: false // 默認收合
      }))
      .sort((a, b) => a.round - b.round);

    // 最後一輪默認展開
    if (rounds.length > 0) {
      rounds[rounds.length - 1].isExpanded = true;
    }

    return rounds;
  };

  // 新增：切換輪次展開/收合狀態
  const toggleRoundExpansion = (roundIndex: number) => {
    setRoundsData(prev => prev.map((round, index) => 
      index === roundIndex 
        ? { ...round, isExpanded: !round.isExpanded }
        : round
    ));
  };

  // 獲取輪次名稱（修正子賽事名稱顯示邏輯）
  const getRoundName = (roundNumber: number, totalRounds: number): string => {
    if (matchMode === 'round_robin') {
      return '所有比賽';
    }

    if (totalRounds === 1) {
      return `第 ${roundNumber} 輪`;
    }

    // 檢查是否為子賽事
    const isSubContest = contestId && window.location.pathname.includes(`/contest/${contestId}`);
    
    if (roundNumber === totalRounds) {
      // 只有在主賽事中，且是最後一輪時才顯示為決賽
      if (!isSubContest && totalRounds > 2) {
        return '決賽';
      }
      return `第 ${roundNumber} 輪`;
    } else if (roundNumber === totalRounds - 1 && totalRounds > 2) {
      return '準決賽';
    } else if (roundNumber === totalRounds - 2 && totalRounds > 3) {
      return '八強賽';
    } else if (roundNumber === totalRounds - 3 && totalRounds > 4) {
      return '十六強賽';
    } else {
      return `第 ${roundNumber} 輪`;
    }
  };

  // 獲取顯示的隊員名稱文本
  const getTeamMembersDisplay = (match: MatchDetail, teamNumber: 1 | 2): React.ReactNode => {
    const isTeam1 = teamNumber === 1;
    const teamMembers = isTeam1 ? match.team1_members : match.team2_members;
    const membersSubmitted = isTeam1 ? match.team1_members_submitted : match.team2_members_submitted;
    const teamId = isTeam1 ? match.team1_id : match.team2_id;
    const bothSubmitted = match.team1_members_submitted && match.team2_members_submitted;
    const isSelfTeam = isAdmin || currentContestTeamId === teamId;

    if (bothSubmitted) {
      return teamMembers.join(', ');
    }
    if (isSelfTeam) {
      if (membersSubmitted) {
        return teamMembers.join(', ');
      } else {
        return <span className="text-gray-400">人員名單未提</span>;
      }
    }
    if (membersSubmitted) {
      return <span className="italic">人員名單已提</span>;
    } else {
      return <span className="text-gray-400">人員名單未提</span>;
    }
  };

  const shouldShowArrow = (match: MatchDetail): boolean => {
    return match.team1_members_submitted && match.team2_members_submitted;
  };

  // 新增：取得選手狀態顯示的函數
  const getPlayerStatus = (match: MatchDetail, teamNumber: 1 | 2, playerIndex: number): React.ReactNode => {
    if (!match.match_detail_id || !playerStatusMap[match.match_detail_id]) {
      return null;
    }
    
    if ((match.match_type === 'single' || match.match_type === '單打')) {
      if (playerIndex > 0) {
        return null;
      }
      
      const singlePlayerStatusKey = `player${teamNumber === 1 ? 0 : 2}_status` as keyof typeof playerStatusMap[number];
      const status = playerStatusMap[match.match_detail_id][singlePlayerStatusKey];
      
      if (!status) return null;
      
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
      const statusKey = `player${playerIndex + (teamNumber === 1 ? 0 : 2)}_status` as keyof typeof playerStatusMap[number];
      const status = playerStatusMap[match.match_detail_id][statusKey];
      
      if (!status) return null;
      
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
      return false;
    }
    const statusMap = playerStatusMap[match.match_detail_id];
    const hasRejection = Object.values(statusMap).includes('已拒絕');
    return !hasRejection;
  };

  useEffect(() => {
    const fetchData = async () => {
      await checkUserRole();
      const fetchedTableCount = await fetchContestDetails();
      await fetchMatches(fetchedTableCount);
      await fetchAllTeams();
    };
    
    try {
      const storedUser = JSON.parse(localStorage.getItem('loginUser') || '{}');
      setLocalStorageUser(storedUser);
      
      if (storedUser.userName && !currentUserName) {
        setCurrentUserName(storedUser.userName);
      }
      
      if (storedUser.team_id && !currentUserTeamId) {
        setCurrentUserTeamId(storedUser.team_id);
      }
      
      console.log('從 localStorage 獲取的用戶資訊:', storedUser);
    } catch (err) {
      console.error('解析 localStorage 用戶資訊錯誤:', err);
    }
    
    fetchData();
  }, [contestId]);

  // 更新 matches 後重新分組
  useEffect(() => {
    if (matches && matches.length > 0) {
      const groupedRounds = groupMatchesByRound(matches);
      setRoundsData(groupedRounds);
      fetchCaptainsForAllTeams();
    }
  }, [matches, matchMode]);

  // 修改 fetchCaptainsForAllTeams 函數
  const fetchCaptainsForAllTeams = async () => {
    try {
      if (!matches || matches.length === 0) {
        console.log('沒有比賽資料，跳過獲取隊長資訊');
        return;
      }
      
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

  // 新增：取得選手狀態
  useEffect(() => {
    async function fetchPlayerStatus() {
      if (!matches.length) return;
      
      const matchDetailIds = matches
        .filter(match => match.match_detail_id)
        .map(match => match.match_detail_id);
        
      if (matchDetailIds.length === 0) return;
      
      const { data, error } = await supabase
        .from('challenge_status_logs')
        .select('match_detail_id, player1_status, player2_status, player3_status, player4_status')
        .in('match_detail_id', matchDetailIds);
        
      if (error || !data) {
        console.error('獲取選手狀態失敗:', error);
        return;
      }
      
      console.log('從 challenge_status_logs 取得的數據:', data);
      
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
      const storedUser = JSON.parse(localStorage.getItem('loginUser') || '{}');
      console.log('從 localStorage 獲取的用戶信息:', storedUser);
      
      if (storedUser && Object.keys(storedUser).length > 0) {
        const isUserAdmin = storedUser.role === 'admin' || storedUser.is_admin === true;
        setIsAdmin(isUserAdmin);
        
        const username = storedUser.userName || storedUser.username || storedUser.name || '';
        setCurrentUserName(username);
        
        if (!storedUser.team_name && storedUser.team_id) {
          try {
            const { data } = await supabase
              .from('courts')
              .select('name')
              .eq('team_id', storedUser.team_id)
              .maybeSingle();
            
            if (data?.name) {
              storedUser.team_name = data.name;
            }
          } catch (err) {
            console.error('獲取球隊名稱失敗:', err);
          }
        }
        
        setLocalStorageUser(storedUser);
        
        if (storedUser.team_id) {
          setCurrentUserTeamId(storedUser.team_id);
          await fetchUserContestTeamId();
          return;
        }
      }
      
      console.log('localStorage 沒有用戶信息，嘗試從 Supabase 獲取');
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      
      if (userError) {
        console.error('獲取 Supabase 用戶錯誤:', userError);
        return;
      }
      
      if (user) {
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
          
          if (userData.team_id) {
            setCurrentUserTeamId(userData.team_id);
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
      const storedUser = JSON.parse(localStorage.getItem('loginUser') || '{}');
      const memberId = storedUser.member_id;
      if (!memberId) {
        console.log('localStorage 無 member_id，無法查詢 contest_team_member');
        setCurrentContestTeamId(null);
        return;
      }
      
      console.log(`嘗試通過 member_id=${memberId} 查詢 contest_id=${contestId} 的 contest_team_id...`);
      
      // 獲取父賽事ID（如果存在）
      let parentContestId;
      try {
        const { data: contestData } = await supabase
          .from('contest')
          .select('parent_contest_id')
          .eq('contest_id', parseInt(contestId))
          .single();
        parentContestId = contestData?.parent_contest_id;
      } catch (err) {
        console.log('獲取父賽事ID失敗:', err);
      }
      
      // 首先檢查當前賽事中的參與情況
      const { data: memberData, error: memberError } = await supabase
        .from('contest_team_member')
        .select('contest_team_id')
        .eq('member_id', memberId)
        .eq('contest_id', parseInt(contestId));
        
      if (memberError) {
        console.log('查詢當前賽事的 contest_team_member 表錯誤:', memberError);
      }
      
      // 如果在當前賽事中找到了參與記錄
      if (memberData && memberData.length > 0) {
        console.log('找到當前賽事的 contest_team_id:', memberData[0].contest_team_id);
        setCurrentContestTeamId(memberData[0].contest_team_id);
        return;
      }
      
      // 如果當前賽事中未找到參與記錄，且存在父賽事ID，則檢查父賽事
      if (parentContestId) {
        console.log(`在當前賽事未找到參與記錄，嘗試查詢父賽事 ID=${parentContestId}`);
        const { data: parentMemberData, error: parentMemberError } = await supabase
          .from('contest_team_member')
          .select('contest_team_id')
          .eq('member_id', memberId)
          .eq('contest_id', parentContestId);
          
        if (parentMemberError) {
          console.log('查詢父賽事的 contest_team_member 表錯誤:', parentMemberError);
          setCurrentContestTeamId(null);
          return;
        }
        
        if (parentMemberData && parentMemberData.length > 0) {
          console.log('找到父賽事的 contest_team_id:', parentMemberData[0].contest_team_id);
          setCurrentContestTeamId(parentMemberData[0].contest_team_id);
          return;
        }
      }
      
      console.log('未找到用戶在此比賽或父比賽中的 contest_team_id');
      setCurrentContestTeamId(null);
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
        .select('contest_name, table_count, total_points, match_mode')
        .eq('contest_id', contestId)
        .single();

      if (error) throw error;
      if (data) {
        console.log('查詢結果:', data);
        console.log('比賽名稱:', data.contest_name);
        console.log('桌次數量 (table_count):', data.table_count);
        
        const tableCountValue = data.table_count !== undefined && data.table_count !== null 
          ? Math.max(1, data.table_count) 
          : 1;
        
        setContestName(data.contest_name);
        setTableCount(tableCountValue);
        console.log('設置後的 tableCount 狀態變量:', tableCountValue);

        const totalPointsValue = data.total_points !== undefined && data.total_points !== null
          ? Math.max(1, data.total_points)
          : 1;
        setTotalPoints(totalPointsValue);
        console.log('設置後的 totalPoints 狀態變量:', totalPointsValue);
        
        if (data.match_mode) {
          setMatchMode(data.match_mode);
          console.log('比賽類型 (match_mode):', data.match_mode);
        }
        
        return tableCountValue;
      }
      return 1;
    } catch (err: any) {
      setError(err.message);
      return 1;
    }
  };

  // 檢查比賽是否已結束
  const checkContestCompleted = (matches: MatchDetail[]) => {
    if (matches.length === 0) return false;
    
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
      console.log('開始獲取比賽數據，可用標次數量:', availableTables);
      console.log('獲取當前賽事 ID的比賽數據:', contestId);
      
      // 確保查詢的是當前賽事 ID 的比賽資料，而非父賽事的
      const { data: matchData, error: matchError } = await supabase
        .from('contest_match')
        .select('match_id, team1_id, team2_id')
        .eq('contest_id', parseInt(contestId));

      if (matchError) throw matchError;

      if (matchData && matchData.length > 0) {
        console.log('找到的比賽數量:', matchData.length);
        
        // 從matchData提取match_id列表進行過濾
        const matchIds = matchData.map((match: any) => match.match_id);
        console.log('當前賽事的比賽ID列表:', matchIds);
        
        const { data: detailData, error: detailError } = await supabase
          .from('contest_match_detail')
          .select('match_detail_id, match_id, team1_member_ids, team2_member_ids, winner_team_id, score, sequence, bracket_round, match_type, table_no')
          .in('match_id', matchIds); // 僅獲取當前賽事的比賽詳情
            
        if (detailError) throw detailError;

        // 獲取團隊和成員數據，確保使用當前子賽事ID
        console.log('獲取當前子賽事ID的團隊數據:', parseInt(contestId));
        const { data: teamsData } = await supabase
          .from('contest_team')
          .select('*')
          .eq('contest_id', parseInt(contestId));
        
        // 詳細記錄所有團隊數據
        console.log('從數據庫獲取的全部團隊數據:', teamsData);
        
        // 逐個檢查團隊數據結構
        if (teamsData && teamsData.length > 0) {
          teamsData.forEach((team: any, index: number) => {
            console.log(`團隊 ${index+1} 數據:`, {
              contest_team_id: team.contest_team_id,
              team_id: team.team_id,
              team_name: team.team_name,
              contest_id: team.contest_id
            });
          });
        } else {
          console.error('未找到任何團隊數據!');
        }
        
        console.log('找到的團隊數量:', teamsData?.length || 0);
        
        // 獲取全部contest_team_member資料，不做過濾
        console.log('獲取全部contest_team_member資料');
        const { data: allMemberData } = await supabase
          .from('contest_team_member')
          .select('*');
        
        console.log('找到的所有成員數量:', allMemberData?.length || 0);
        
        // 按照團隊ID過濾當前賽事的成員
        const teamIds = teamsData?.map((t: any) => t.contest_team_id) || [];
        console.log('當前賽事所有團隊ID (contest_team_id):', teamIds);
        
        const memberData = allMemberData?.filter((m: any) => 
          teamIds.includes(m.contest_team_id)
        ) || [];
        
        console.log('當前賽事的成員數量:', memberData?.length || 0);
        console.log('成員資料範例:', memberData.length > 0 ? memberData[0] : 'No members');
        
        // 創建成員ID到名稱的映射表
        const memberIdToNameMap: Record<string, string> = {};
        allMemberData?.forEach((member: any) => {
          if (member.member_id && member.member_name) {
            memberIdToNameMap[member.member_id] = member.member_name;
          }
        });
        
        console.log('成員ID到名稱映射表範例:', Object.entries(memberIdToNameMap).slice(0, 3));
        
        console.log('找到的成員數量:', memberData?.length || 0);
          
        const processedMatches = detailData.map((detail: any) => {
          const match = matchData.find((m: any) => m.match_id === detail.match_id);
          
          // 詳細記錄比賽資訊
          console.log('正在處理比賽:', {
            match_detail_id: detail.match_detail_id,
            team1_id: match?.team1_id,
            team2_id: match?.team2_id,
            winner_team_id: detail.winner_team_id
          });
          
          // 嘗試多種方式查找隊伍
          // 先嘗試直接使用team_id匹配
          let team1 = teamsData?.find((t: any) => t.team_id === match?.team1_id);
          let team2 = teamsData?.find((t: any) => t.team_id === match?.team2_id);
          let winnerTeam = detail.winner_team_id ? teamsData?.find((t: any) => t.team_id === detail.winner_team_id) : null;
          
          // 如果使用team_id找不到，則嘗試使用contest_team_id
          if (!team1) team1 = teamsData?.find((t: any) => t.contest_team_id === match?.team1_id);
          if (!team2) team2 = teamsData?.find((t: any) => t.contest_team_id === match?.team2_id);
          if (detail.winner_team_id && !winnerTeam) {
            winnerTeam = teamsData?.find((t: any) => t.contest_team_id === detail.winner_team_id);
          }
          
          // 詳細記錄隊伍查詢結果
          console.log('隊伍1查詢結果:', {
            team1_id: match?.team1_id,
            查詢條件: `contest_team_id === ${match?.team1_id}`,
            找到隊伍: team1 ? JSON.stringify(team1) : '未找到',
            隊伍名稱: team1?.team_name || '無名稱'
          });
          
          console.log('隊伍2查詢結果:', {
            team2_id: match?.team2_id,
            查詢條件: `contest_team_id === ${match?.team2_id}`,
            找到隊伍: team2 ? JSON.stringify(team2) : '未找到',
            隊伍名稱: team2?.team_name || '無名稱'
          });
          
          if (detail.winner_team_id) {
            console.log('獲勝隊伍查詢結果:', {
              winner_team_id: detail.winner_team_id,
              查詢條件: `contest_team_id === ${detail.winner_team_id}`,
              找到隊伍: winnerTeam ? JSON.stringify(winnerTeam) : '未找到',
              隊伍名稱: winnerTeam?.team_name || '無名稱'
            });
          }
          
          // 詳細記錄獲勝隊伍查找結果
          if (detail.winner_team_id) {
            console.log('查找獲勝隊伍結果:', {
              winner_team_id: detail.winner_team_id,
              找到的隊伍: winnerTeam?.team_name || '未找到',
              隊伍1名稱: team1?.team_name,
              隊伍2名稱: team2?.team_name
            });
          }
          
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
          
          // 從具體ID映射到成員名稱
          const team1Members = team1MembersSubmitted ? team1Ids.map(memberId => {
            // 1. 直接使用映射表查找成員名稱
            if (memberIdToNameMap[memberId]) {
              console.log('找到成員名稱(從映射表):', memberIdToNameMap[memberId], '對應ID:', memberId);
              return memberIdToNameMap[memberId];
            }
            
            // 2. 如果映射表中沒有，嘗試在team1_id對應的團隊中查找
            const member = memberData?.find((m: any) => 
              m.contest_team_id === match?.team1_id && 
              m.member_id === memberId
            );
            
            if (member?.member_name) {
              console.log('找到成員名稱(從指定團隊):', member.member_name, '對應ID:', memberId);
              return member.member_name;
            }
            
            // 3. 在任何團隊中查找該成員ID
            const anyTeamMember = memberData?.find((m: any) => m.member_id === memberId);
            if (anyTeamMember?.member_name) {
              console.log('找到成員名稱(從任意團隊):', anyTeamMember.member_name, '對應ID:', memberId);
              return anyTeamMember.member_name;
            }
            
            // 如果依然找不到，返回成員ID
            return memberId;
          }) : [];
          
          // 同樣處理team2成員
          const team2Members = team2MembersSubmitted ? team2Ids.map(memberId => {
            // 1. 直接使用映射表查找成員名稱
            if (memberIdToNameMap[memberId]) {
              return memberIdToNameMap[memberId];
            }
            
            // 2. 如果映射表中沒有，嘗試在team2_id對應的團隊中查找
            const member = memberData?.find((m: any) => 
              m.contest_team_id === match?.team2_id && 
              m.member_id === memberId
            );
            
            if (member?.member_name) {
              return member.member_name;
            }
            
            // 3. 在任何團隊中查找該成員ID
            const anyTeamMember = memberData?.find((m: any) => m.member_id === memberId);
            if (anyTeamMember?.member_name) {
              return anyTeamMember.member_name;
            }
            
            // 如果依然找不到，返回成員ID
            return memberId;
          }) : [];
          
          // 逐個檢查團隊數據結構
          if (teamsData && teamsData.length > 0) {
            teamsData.forEach((team: any, index: number) => {
              console.log(`團隊 ${index+1} 數據:`, {
                contest_team_id: team.contest_team_id,
                team_id: team.team_id,
                team_name: team.team_name,
                contest_id: team.contest_id
              });
            });
          }
          
          // 確保隊伍名稱不為空
          // 使用 team_id 查詢 contest_team 表獲取正確的隊伍名稱
          let team1Name = team1?.team_name || '';
          let team2Name = team2?.team_name || '';
          
          // 如果隊伍名稱為空，則嘗試從 contest_team 表中查詢
          if (!team1Name && match?.team1_id) {
            console.log(`嘗試從 contest_team 表查詢隊伍1名稱，team_id: ${match.team1_id}`);
            // 這裡不需要立即查詢，我們將在後面批量查詢
          }
          
          if (!team2Name && match?.team2_id) {
            console.log(`嘗試從 contest_team 表查詢隊伍2名稱，team_id: ${match.team2_id}`);
            // 這裡不需要立即查詢，我們將在後面批量查詢
          }
          
          // 如果仍然沒有名稱，使用默認值
          team1Name = team1Name || `隊伍 ${match?.team1_id}`;
          team2Name = team2Name || `隊伍 ${match?.team2_id}`;
          
          const winnerTeamName = winnerTeam?.team_name || 
            (detail.winner_team_id === match?.team1_id ? team1Name : 
             detail.winner_team_id === match?.team2_id ? team2Name : '');
          
          // 記錄最終結果以便檢查
          console.log('最終處理結果:', {
            比賽ID: detail.match_id,
            勝利隊伍ID: detail.winner_team_id,
            勝利隊伍名稱: winnerTeamName,
            隊伍1名稱: team1Name,
            隊伍2名稱: team2Name
          });
          
          const result = {
            ...detail,
            team1_id: match?.team1_id,
            team2_id: match?.team2_id,
            team1_name: team1Name,
            team2_name: team2Name,
            team1_members: team1Members,
            team2_members: team2Members,
            team1_members_submitted: team1MembersSubmitted,
            team2_members_submitted: team2MembersSubmitted,
            winner_team_name: winnerTeamName,
            bracket_round: detail.bracket_round // 確保包含 bracket_round
          };
          
          return result;
        });
        

        const sortedMatches = sortMatchesByDetailId(processedMatches);
        
        // 收集所有需要查詢隊伍名稱的 team_id
        const teamIdsToQuery = new Set<number>();
        sortedMatches.forEach(match => {
          if (match.team1_id) teamIdsToQuery.add(match.team1_id);
          if (match.team2_id) teamIdsToQuery.add(match.team2_id);
          if (match.winner_team_id) teamIdsToQuery.add(match.winner_team_id);
        });
        
        // 如果有需要查詢的 team_id，則從 contest_team 表中查詢
        if (teamIdsToQuery.size > 0) {
          console.log('需要查詢隊伍名稱的 team_id:', Array.from(teamIdsToQuery));
          
          try {
            // 從 contest_team 表查詢隊伍名稱，使用 contest_team_id 欄位進行查詢
            const { data: teamData, error: teamError } = await supabase
              .from('contest_team')
              .select('contest_team_id, team_name')
              .in('contest_team_id', Array.from(teamIdsToQuery));
            
            if (teamError) {
              console.error('查詢 contest_team 表錯誤:', teamError);
            } else if (teamData && teamData.length > 0) {
              console.log('從 contest_team 表查詢到的隊伍數據:', teamData);
              
              // 創建 team_id 到 team_name 的映射
              const teamIdToNameMap: Record<number, string> = {};
              teamData.forEach((team: any) => {
                if (team.contest_team_id && team.team_name) {
                  teamIdToNameMap[team.contest_team_id] = team.team_name;
                }
              });
              
              // 更新每個比賽的隊伍名稱
              sortedMatches.forEach(match => {
                if (match.team1_id && teamIdToNameMap[match.team1_id]) {
                  match.team1_name = teamIdToNameMap[match.team1_id];
                  console.log(`更新隊伍1名稱: ${match.team1_name}, ID: ${match.team1_id}`);
                }
                
                if (match.team2_id && teamIdToNameMap[match.team2_id]) {
                  match.team2_name = teamIdToNameMap[match.team2_id];
                  console.log(`更新隊伍2名稱: ${match.team2_name}, ID: ${match.team2_id}`);
                }
                
                if (match.winner_team_id && teamIdToNameMap[match.winner_team_id]) {
                  match.winner_team_name = teamIdToNameMap[match.winner_team_id];
                  console.log(`更新獲勝隊伍名稱: ${match.winner_team_name}, ID: ${match.winner_team_id}`);
                }
              });
            }
            
            // 如果還有未找到名稱的隊伍，嘗試從 courts 表查詢
            const remainingTeamIds = new Set<number>();
            sortedMatches.forEach(match => {
              if (match.team1_id && match.team1_name === `隊伍 ${match.team1_id}`) {
                remainingTeamIds.add(match.team1_id);
              }
              if (match.team2_id && match.team2_name === `隊伍 ${match.team2_id}`) {
                remainingTeamIds.add(match.team2_id);
              }
            });
            
            if (remainingTeamIds.size > 0) {
              console.log('從 courts 表查詢剩餘隊伍名稱:', Array.from(remainingTeamIds));
              
              const { data: courtsData, error: courtsError } = await supabase
                .from('courts')
                .select('team_id, name')
                .in('team_id', Array.from(remainingTeamIds));
              
              if (courtsError) {
                console.error('查詢 courts 表錯誤:', courtsError);
              } else if (courtsData && courtsData.length > 0) {
                console.log('從 courts 表查詢到的隊伍數據:', courtsData);
                
                // 創建 team_id 到 name 的映射
                const courtsTeamIdToNameMap: Record<number, string> = {};
                courtsData.forEach((court: any) => {
                  if (court.team_id && court.name) {
                    courtsTeamIdToNameMap[court.team_id] = court.name;
                  }
                });
                
                // 更新每個比賽的隊伍名稱
                sortedMatches.forEach(match => {
                  if (match.team1_id && courtsTeamIdToNameMap[match.team1_id] && match.team1_name === `隊伍 ${match.team1_id}`) {
                    match.team1_name = courtsTeamIdToNameMap[match.team1_id];
                    console.log(`從 courts 表更新隊伍1名稱: ${match.team1_name}, ID: ${match.team1_id}`);
                  }
                  
                  if (match.team2_id && courtsTeamIdToNameMap[match.team2_id] && match.team2_name === `隊伍 ${match.team2_id}`) {
                    match.team2_name = courtsTeamIdToNameMap[match.team2_id];
                    console.log(`從 courts 表更新隊伍2名稱: ${match.team2_name}, ID: ${match.team2_id}`);
                  }
                  
                  if (match.winner_team_id && courtsTeamIdToNameMap[match.winner_team_id] && 
                      (match.winner_team_name === '' || match.winner_team_name === `隊伍 ${match.winner_team_id}`)) {
                    match.winner_team_name = courtsTeamIdToNameMap[match.winner_team_id];
                    console.log(`從 courts 表更新獲勝隊伍名稱: ${match.winner_team_name}, ID: ${match.winner_team_id}`);
                  }
                });
              }
            }
          } catch (err) {
            console.error('查詢隊伍名稱時發生錯誤:', err);
          }
        }
        
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
    return [...matches].sort((a, b) => {
      const idA = Number(a.match_detail_id);
      const idB = Number(b.match_detail_id);
      return idA - idB;
    });
  };
  
  // 桌次分配邏輯
  const assignTableNumbers = async (matches: MatchDetail[], availableTables: number) => {
    console.log('執行桌次分配函數，檢查是否需要分配桌次');
    
    try {
      const hasAnyTableAssigned = matches.some(m => m.table_no !== null && m.table_no !== 'Next');
      
      if (hasAnyTableAssigned) {
        console.log('資料庫中已有桌次分配，跳過初始分配步驟');
        return matches;
      }
      
      const tables = Math.max(1, availableTables);
      console.log('使用的桌次數量:', tables);
      
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
      
      const usedTables = new Set<number>();
      const tableAssignments = [];
      
      for (let i = 0; i < Math.min(tables, eligibleMatches.length); i++) {
        const match = eligibleMatches[i];
        const tableNo = i + 1;
        
        console.log(`分配桌次: ID ${match.match_detail_id}, 桌次 ${tableNo}`);
        tableAssignments.push({ matchId: match.match_detail_id, tableNo: tableNo.toString() });
        usedTables.add(tableNo);
        match.table_no = tableNo;
      }
      
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
      
      const { error: fetchError } = await supabase
        .from('contest_match_detail')
        .select('*')
        .eq('match_detail_id', matchDetailId)
        .single();
        
      if (fetchError) {
        console.error('獲取目前比賽資料錯誤:', fetchError);
        throw fetchError;
      }
      
      const { error } = await supabase
        .from('contest_match_detail')
        .update({ 
          score,
        })
        .eq('match_detail_id', matchDetailId);

      if (error) {
        console.error('更新比分錯誤:', error);
        throw error;
      }
      
      console.log(`比賽 ID ${matchDetailId} 的比分已更新為 ${score}`);
      
      fetchMatches();
    } catch (err: any) {
      console.error('更新比分失敗:', err.message);
      setError(err.message);
    }
  };

  // 前往比賽頁面
  const navigateToGame = async (match: MatchDetail) => {
    const params = new URLSearchParams();
    
    params.append('from_battleroom', 'true');
    params.append('match_detail_id', match.match_detail_id.toString());
    
    params.append('team1_name', match.team1_name);
    params.append('team2_name', match.team2_name);
    
    const team1Ids = typeof match.team1_member_ids === 'string' 
      ? JSON.parse(match.team1_member_ids) 
      : match.team1_member_ids;
      
    const team2Ids = typeof match.team2_member_ids === 'string' 
      ? JSON.parse(match.team2_member_ids) 
      : match.team2_member_ids;
    
    const isSingleMatch = (() => {
      if (match.match_type === 'single' || match.match_type === '單打') return true;
      if (match.match_type === 'double' || match.match_type === '雙打') return false;
      
      const team1MemberCount = Array.isArray(team1Ids) ? team1Ids.length : 0;
      const team2MemberCount = Array.isArray(team2Ids) ? team2Ids.length : 0;
      
      if (team1MemberCount <= 1 && team2MemberCount <= 1) return true;
      if (team1MemberCount >= 2 || team2MemberCount >= 2) return false;
      
      return true;
    })();
    
    try {
      if (isSingleMatch) {
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
        
        params.append('team1_members', JSON.stringify(match.team1_members));
        params.append('team2_members', JSON.stringify(match.team2_members));
        
        if (match.team1_id) {
          params.append('team1_id', match.team1_id.toString());
        }
        
        if (match.team2_id) {
          params.append('team2_id', match.team2_id.toString());
        }
        
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
  const getFilteredMatches = (roundMatches: MatchDetail[]) => {
    return roundMatches.filter((match: MatchDetail) => {
      let keywordMatches = true;
      if (searchKeyword !== '') {
        const keyword = searchKeyword.toLowerCase();
        
        const team1MembersMatch = match.team1_members?.some((member: string) => {
          const isMatch = member.toLowerCase().includes(keyword);
          if (isMatch) {
            const isCaptain = match.team1_id && teamCaptains[match.team1_id.toString()] === member;
            console.log(`關鍵字 "${keyword}" 匹配到隊伍1成員: ${member}${isCaptain ? ' (隊長)' : ''}`);
          }
          return isMatch;
        }) || false;
        
        const team2MembersMatch = match.team2_members?.some((member: string) => {
          const isMatch = member.toLowerCase().includes(keyword);
          if (isMatch) {
            const isCaptain = match.team2_id && teamCaptains[match.team2_id.toString()] === member;
            console.log(`關鍵字 "${keyword}" 匹配到隊伍2成員: ${member}${isCaptain ? ' (隊長)' : ''}`);
          }
          return isMatch;
        }) || false;
        
        const team1NameMatch = match.team1_name?.toLowerCase().includes(keyword) || false;
        const team2NameMatch = match.team2_name?.toLowerCase().includes(keyword) || false;
        
        keywordMatches = team1MembersMatch || team2MembersMatch;
        
        if (keywordMatches) {
          console.log(`比賽 ${match.match_detail_id} 匹配關鍵字 "${keyword}":`, {
            team1MembersMatch,
            team2MembersMatch
          });
        }
      }
      
      const teamMatches = selectedTeamId === null || 
        match.team1_id === selectedTeamId || 
        match.team2_id === selectedTeamId;
      
      return keywordMatches && teamMatches;
    });
  };

  // handleSearchSelf 函數保持不變
  const handleSearchSelf = () => {
    setSelectedTeamId(null);
    
    const userName = localStorageUser?.userName || currentUserName;
    
    if (userName) {
      console.log(`執行搜尋自己操作，設置搜尋關鍵字為: ${userName}`);
      setSearchKeyword(userName);
      return;
    }
    
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
      navigate(`/contest/${contestId}/table-view`);
    }
  };

  // 直接前往約戰頁面的按鈕處理函數
  const navigateToChallenge = async (match: MatchDetail) => {
    try {
      const userTeamId = localStorageUser?.team_id || '';
      
      let playerIds: string[] = [];
      let playerNames: string[] = [];
      
      const team1Ids = typeof match.team1_member_ids === 'string' 
        ? JSON.parse(match.team1_member_ids) 
        : match.team1_member_ids || [];
      
      const team2Ids = typeof match.team2_member_ids === 'string' 
        ? JSON.parse(match.team2_member_ids) 
        : match.team2_member_ids || [];
      
      if (match.match_type === 'single' || match.match_type === '單打') {
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
      
      if (playerIds.length === 0) {
        console.warn('無法發起約戰，因為沒有成員 IDs');
        return;
      }
      
      let correctTeamName = localStorageUser?.team_name || '';
      
      if (!correctTeamName && userTeamId) {
        if (userTeamId === match.team1_id?.toString()) {
          correctTeamName = match.team1_name;
        } else if (userTeamId === match.team2_id?.toString()) {
          correctTeamName = match.team2_name;
        }
      }
      
      correctTeamName = correctTeamName || userTeamId;
      
      console.log('約戰資訊:', {
        playerIds,
        playerNames,
        match_detail_id: match.match_detail_id.toString(),
        teamId: userTeamId,
        teamName: correctTeamName,
        matchTeam1: match.team1_name,
        matchTeam2: match.team2_name
      });
      
      navigate('/create-challenge', { 
        state: {
          teamId: userTeamId, 
          teamName: correctTeamName,
          playerIds: playerIds,
          playerNames: playerNames,
          matchDetailId: match.match_detail_id.toString()
        }
      });
      
    } catch (err: any) {
      console.error('導航到約戰頁面失敗:', err);
      setError(err.message);
    }
  };

  // 新增：渲染單個比賽卡片的函數
  const renderMatchCard = (match: MatchDetail, index: number, allMatches: MatchDetail[]) => {
    // 出賽點循環顯示邏輯
    let point = 1;
    if (totalPoints && totalPoints > 0) {
      for (let i = 0, group = 0; i < allMatches.length; i++) {
        const m = allMatches[i];
        if (i === 0 || m.team1_id !== allMatches[i - 1].team1_id || m.team2_id !== allMatches[i - 1].team2_id) {
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

        <div className="flex justify-between items-center mb-4">
          {/* 隊伍1 */}
          <div className="text-center w-2/5">
            <div className="font-bold text-lg">{match.team1_name}</div>
             <div className="text-xs text-gray-500">
              隊長: {match.team1_id && teamCaptains[match.team1_id.toString()] ? teamCaptains[match.team1_id.toString()] : '無隊長'}
            </div>
            <div className="text-sm mt-1 text-gray-600">
              {getTeamMembersDisplay(match, 1)}
              {match.match_detail_id && (match.match_type === 'single' || match.match_type === '單打') && (
                <div className="mt-1 text-xs">
                  {match.team1_members && match.team1_members.length > 0 && playerStatusMap[match.match_detail_id] && (
                    <div className="mt-0.5">{playerStatusMap[match.match_detail_id].player1_status || '未讀取'}</div>
                  )}
                </div>
              )}
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
            <div className="font-bold text-2xl flex items-center justify-center space-x-2">
              {(() => {
                if (!match.score) return '- : -';
                
                // 根據獲勝方調整比分顯示順序
                if (match.winner_team_id) {
                  const [score1, score2] = match.score.split(':').map(Number);
                  
                  // 檢查比分是否符合獲勝隊伍的邏輯
                  if (match.winner_team_id === match.team1_id && score1 <= score2) {
                    // 如果獲勝隊伍是隊伍1，但分數不大於隊伍2，則調整比分
                    console.log(`調整比分：隊伍1獲勝 ${match.team1_name}，原始比分 ${score1}:${score2} -> ${score2}:${score1}`);
                    return `${score2}:${score1}`;
                  } else if (match.winner_team_id === match.team2_id && score2 <= score1) {
                    // 如果獲勝隊伍是隊伍2，但分數不大於隊伍1，則調整比分
                    console.log(`調整比分：隊伍2獲勝 ${match.team2_name}，原始比分 ${score1}:${score2} -> ${score2}:${score1}`);
                    return `${score2}:${score1}`;
                  }
                }
                
                // 如果沒有獲勝隊伍或比分已符合獲勝邏輯，則使用原始比分
                // 使用原始比分
                return match.score;
              })()}
            </div>
          </div>

          {/* 隊伍2 */}
          <div className="text-center w-2/5">
            <div className="font-bold text-lg">{match.team2_name}</div>
       
            <div className="text-xs text-gray-500">
              隊長: {match.team2_id && teamCaptains[match.team2_id.toString()] ? teamCaptains[match.team2_id.toString()] : '無隊長'}
            </div>
            <div className="text-sm mt-1 text-gray-600">
              {getTeamMembersDisplay(match, 2)}
              {match.match_detail_id && (match.match_type === 'single' || match.match_type === '單打') && (
                <div className="mt-1 text-xs">
                  {match.team2_members && match.team2_members.length > 0 && playerStatusMap[match.match_detail_id] && (
                    <div className="mt-0.5">{playerStatusMap[match.match_detail_id].player2_status || '未讀取'}</div>
                  )}
                </div>
              )}
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
                {/* 添加調試日誌以查看獲勝隊伍名稱 */}
                {console.log('渲染獲勝隊伍名稱:', {
                  winner_team_id: match.winner_team_id,
                  winner_team_name: match.winner_team_name,
                  team1_id: match.team1_id,
                  team1_name: match.team1_name,
                  team2_id: match.team2_id,
                  team2_name: match.team2_name
                })}
                
                {/* 簡化顯示邏輯，優先使用已經計算好的winner_team_name */}
                {match.winner_team_name ? 
                  `${match.winner_team_name} 獲勝` : 
                  (match.winner_team_id === match.team1_id ? 
                    `${match.team1_name || '隊伍1'} 獲勝` : 
                    `${match.team2_name || '隊伍2'} 獲勝`)
                }
              </span>
              {isAdmin && (
                <button
                  className="bg-red-500 hover:bg-red-600 text-white text-xs px-2 py-1 rounded"
                  onClick={() => {
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
                      const roundGroups: {[key: number]: MatchDetail[]} = {};
                  
                  // 根據比賽數量和對戰樹結構推算輪次
                  filteredMatches.forEach((match) => {
                    // 處理不同數據結構中的輪次屬性
                    // 優先使用 round 屬性，然後嘗試 bracket_round，最後默認為 1
                    const round = match.round || match.bracket_round || 1;
                    if (!roundGroups[round]) roundGroups[round] = [];
                    roundGroups[round].push(match);
                  });
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
        </div>
      </div>
    );
  };

  return (
    <div className="container mx-auto px-4 py-8">
      {/* 使用者資訊區塊 */}
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
      ) : (
        <div>
          {/* 頁面標題和操作按鈕區域 */}
          <div className="flex justify-between items-center mb-6">
            <div className="text-2xl font-bold text-gray-800">{contestName}</div>
            <div className="flex space-x-2">
              <button
                onClick={navigateToResults}
                className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-md flex items-center"
              >
                ←
                {matchMode === 'elimination' ? '對戰表' : '比分表'}
              </button>
              <button
                onClick={() => navigate(`/contest/${contestId}/lineup-status`)}
                className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-md"
              >
                名單狀況
              </button>
              <button
                onClick={handleSortByTable}
                className="bg-purple-500 hover:bg-purple-600 text-white px-4 py-2 rounded-md"
              >
                依桌次
              </button>
            </div>
          </div>
          
          {/* 搜尋和過濾區域 */}
          <div className="mb-6 bg-white p-3 rounded-lg shadow-sm border">
            <div className="flex flex-wrap items-center justify-between">
              <div className="flex items-center flex-wrap gap-3 flex-1">
                <h2 className="text-base font-semibold text-blue-800 whitespace-nowrap">搜尋和過濾:</h2>
                
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
              
              <div className="text-sm text-gray-600 whitespace-nowrap">
                顯示 {roundsData.reduce((total, round) => total + getFilteredMatches(round.matches).length, 0)} / {matches.length} 場比賽
              </div>
            </div>
          </div>
        </div>
      )}
      
      {!loading && (
        <div>
          {matches.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              目前沒有對戰資料
            </div>
          ) : roundsData.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              找不到符合條件的比賽
            </div>
          ) : (
            <div className="space-y-6">
              {roundsData.map((roundData, roundIndex) => {
                const filteredMatches = getFilteredMatches(roundData.matches);
                
                // 如果過濾後沒有比賽，跳過這個輪次
                if (filteredMatches.length === 0) {
                  return null;
                }

                return (
                  <div key={roundData.round} className="border border-gray-200 rounded-lg bg-gray-50">
                    {/* 輪次標題欄 - 可點擊展開/收合 */}
                    <div 
                      className="flex justify-between items-center p-4 cursor-pointer hover:bg-gray-100 transition-colors"
                      onClick={() => toggleRoundExpansion(roundIndex)}
                    >
                      <div className="flex items-center space-x-3">
                        <h2 className="text-xl font-bold text-gray-800">
                          {getRoundName(roundData.round, roundsData.length)}
                        </h2>
                        {matchMode === 'elimination' && (
                          <span className="text-sm text-gray-500">
                            (第 {roundData.round} 輪)
                          </span>
                        )}
                      </div>
                      
                      <div className="flex items-center space-x-4">
                        <span className="text-sm text-gray-600">
                          {filteredMatches.length} / {roundData.matches.length} 場比賽
                        </span>
                        
                        {/* 展開/收合圖示 */}
                        <div className={`transform transition-transform duration-200 ${
                          roundData.isExpanded ? 'rotate-180' : ''
                        }`}>
                          <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </div>
                    </div>

                    {/* 比賽內容區域 - 可收合 */}
                    {roundData.isExpanded && (
                      <div className="px-4 pb-4">
                        <div className="space-y-4">
                          {filteredMatches.map((match, matchIndex) => 
                            renderMatchCard(match, matches.indexOf(match), matches)
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          
          {/* 說明區域 */}
          <div className="mt-6 p-4 bg-yellow-50 border border-yellow-200 rounded">
            <h3 className="font-bold text-yellow-800 mb-2">說明</h3>
            <ul className="list-disc pl-5 text-sm text-yellow-700">
              <li>桌次會根據可用桌數自動分配，當有比賽結束後，桌次會自動分配給下一場比賽。</li>
              <li>點擊「→」按鈕可前往比賽頁面，系統會自動排列人員。</li>
              <li>比賽結束後，比分會自動更新。</li>
              {matchMode !== 'round_robin' && (
                <li>淘汰賽模式下，比賽按輪次分組顯示，點擊輪次標題可展開或收合該輪次的比賽。</li>
              )}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
};

export default BattleRoomPage;