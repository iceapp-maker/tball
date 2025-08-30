import React, { useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserContext } from '../UserContext';
import { supabase } from '../supabaseClient';

// 🔒 新增：根據 member_id 前綴獲取登入團隊ID
const getLoginTeamId = (memberId: string): string => {
  if (!memberId) return '';
  return memberId.charAt(0).toUpperCase(); // 取第一個字母作為登入團隊識別
};

// 🔒 新增：根據團隊ID獲取團隊名稱
const getTeamNameByTeamId = async (teamId: string): Promise<string> => {
  if (!teamId) return '';
  
  try {
    const { data, error } = await supabase
      .from('courts')
      .select('name')
      .eq('team_id', teamId)
      .maybeSingle();
    
    if (error || !data) {
      console.error('查詢團隊名稱失敗:', error);
      return '';
    }
    
    return data.name || '';
  } catch (err) {
    console.error('獲取團隊名稱時出錯:', err);
    return '';
  }
};

const NewTodoBlock: React.FC = () => {
  const { user } = useContext(UserContext) ?? { user: null };
  const navigate = useNavigate();
  const [unreadChallenge, setUnreadChallenge] = useState(0);
  const [unreadInvites, setUnreadInvites] = useState(0);
  // 管理員待產生對戰表的比賽
  const [pendingMatchGeneration, setPendingMatchGeneration] = useState<{
    contest_id: number;
    contest_name: string;
  }[]>([]);
  
  // 🎯 新增：待確認結束的比賽
  const [pendingContestFinish, setPendingContestFinish] = useState<{
    contest_id: string;
    contest_name: string;
  }[]>([]);
  
  // 待編排對戰名單的比賽資訊
  const [pendingLineups, setPendingLineups] = useState<{
    count: number;
    matches: {
      match_id: string;
      contest_name: string;
      opponent_name: string;
      team_type: string; // 'team1' 或 'team2'
      contest_team_id: string; // 添加隊伍的 contest_team_id
    }[]
  }>({ count: 0, matches: [] });
  
  // 隊長待處理出賽名單
  const [captainPendingLineups, setCaptainPendingLineups] = useState<{
    match_id: string;
    opponent_team_name: string;
    team_type: string;
    contest_name: string;
    contest_team_id: string; // 隊長的隊伍ID
    pending?: boolean;      // 名單是否待安排
    contest_id?: string;    // 比賽的contest_id
    contest_status?: string; // 比賽狀態
    readyStatus?: 'not_ready' | 'ready' | 'both_ready'; // 名單狀態: not_ready=未安排，ready=已安排，both_ready=雙方已安排
  }[]>([]);

  // 🎯 新增：檢查所有比分是否已填入的函數
  const checkAllScoresFilled = async (contestId: string) => {
    try {
      const { data: matchDetails, error } = await supabase
        .from('contest_match_detail')
        .select('score')
        .eq('contest_id', contestId);

      if (error) throw error;
      
      // 檢查每一點的比分是否都已填入 (格式：a:b，其中a、b為數字)
      return matchDetails && matchDetails.length > 0 && matchDetails.every(
        (detail: any) => {
          // 檢查 score 是否存在且不為空
          if (!detail.score || detail.score.trim() === '') {
            return false;
          }
          
          // 檢查是否符合 a:b 格式 (a、b為數字)
          const scorePattern = /^\d+:\d+$/;
          return scorePattern.test(detail.score.trim());
        }
      );
    } catch (err) {
      console.error('檢查比分時出錯:', err);
      return false;
    }
  };

  // 🎯 新增：查詢待確認結束的比賽
  const fetchPendingContestFinish = async () => {
    // 只有登入用戶才需要查詢
    if (!user?.member_id) {
      setPendingContestFinish([]);
      return;
    }

    try {
      const loginTeamId = getLoginTeamId(user.member_id);
      const loginTeamName = await getTeamNameByTeamId(loginTeamId);
      
      if (!loginTeamName) {
        console.error('無法獲取登入團隊名稱');
        setPendingContestFinish([]);
        return;
      }
      
      // 1. 先獲取該登入團隊主辦且狀態為 'ongoing' 的比賽
      const { data: ongoingContests, error: contestsError } = await supabase
        .from('contest')
        .select('contest_id, contest_name, team_name')
        .eq('contest_status', 'ongoing')  // 只查詢進行中的比賽
        .eq('team_name', loginTeamName)  // 🔒 只查詢同登入團隊主辦的比賽
        .order('contest_id', { ascending: false });

      if (contestsError) {
        console.error('查詢進行中比賽失敗:', contestsError);
        setPendingContestFinish([]);
        return;
      }

      if (!ongoingContests || ongoingContests.length === 0) {
        setPendingContestFinish([]);
        return;
      }

      // 2. 檢查每個進行中比賽的比分填寫狀態
      const contestsNeedingFinish = [];
      for (const contest of ongoingContests) {
        const allScoresFilled = await checkAllScoresFilled(contest.contest_id);
        if (allScoresFilled) {
          contestsNeedingFinish.push({
            contest_id: contest.contest_id,
            contest_name: contest.contest_name
          });
        }
      }

      setPendingContestFinish(contestsNeedingFinish);
      console.log('待確認結束的比賽:', contestsNeedingFinish);
    } catch (err) {
      console.error('查詢待確認結束比賽錯誤:', err);
      setPendingContestFinish([]);
    }
  };

  // 查詢管理員待產生對戰表的比賽
  const fetchPendingMatchGeneration = async () => {
    // 只有管理員才需要查詢
    if (!user?.role || user.role !== 'admin' || !user?.member_id) {
      console.log('🔍 [fetchPendingMatchGeneration] 不符合管理員條件:', { role: user?.role, member_id: user?.member_id });
      setPendingMatchGeneration([]);
      return;
    }

    try {
      const loginTeamId = getLoginTeamId(user.member_id);
      const loginTeamName = await getTeamNameByTeamId(loginTeamId);
      
      if (!loginTeamName) {
        console.error('無法獲取登入團隊名稱');
        setPendingMatchGeneration([]);
        return;
      }
      
      console.log('🔍 [fetchPendingMatchGeneration] 開始查詢:', { 
        member_id: user.member_id, 
        loginTeamId: loginTeamId,
        loginTeamName: loginTeamName,
        role: user.role 
      });
      
      // 只查詢該登入團隊管理員主辦的比賽
      const { data: waitingContests, error } = await supabase
        .from('contest')
        .select('contest_id, contest_name, team_name')
        .eq('contest_status', 'WaitMatchForm')
        .eq('team_name', loginTeamName)  // 🔒 只查詢同登入團隊主辦的比賽
        .order('contest_id', { ascending: false });

      console.log('🔍 [fetchPendingMatchGeneration] 查詢結果:', { 
        waitingContests, 
        error,
        queryFilter: `team_name = '${loginTeamName}'`
      });

      if (error) {
        console.error('查詢待產生對戰表的比賽失敗:', error);
        setPendingMatchGeneration([]);
        return;
      }

      setPendingMatchGeneration(waitingContests || []);
      console.log('🔍 [fetchPendingMatchGeneration] 設置待產生對戰表比賽:', waitingContests?.length || 0, '筆');
    } catch (err) {
      console.error('查詢待產生對戰表錯誤:', err);
      setPendingMatchGeneration([]);
    }
  };

  // 🎯 新增：處理點擊前往賽程控制區
  const handleContestFinishClick = () => {
    console.log('導航到賽程控制區');
    navigate('/contest-control');
  };

  // 查詢未讀挑戰數
  useEffect(() => {
    const fetchUnreadChallenge = async () => {
      if (!user?.name || !user?.team_name) {
        setUnreadChallenge(0);
        return;
      }
      
      const { data, error } = await supabase
        .from('vw_challenge_unread_count')
        .select('unread_count')
        .eq('name', user.name)
        .eq('team_name', user.team_name)
        .maybeSingle();
        
      if (!error && data && typeof data.unread_count === 'number') {
        setUnreadChallenge(data.unread_count);
      } else {
        setUnreadChallenge(0);
      }
    };
    
    fetchUnreadChallenge();
  }, [user?.name, user?.team_name]);
  
  // 查詢未處理賽程邀約數
  useEffect(() => {
    const fetchUnreadInvites = async () => {
      if (!user?.member_id) {
        setUnreadInvites(0);
        return;
      }
      
      const { data, error } = await supabase
        .from('vw_member_invited_count')
        .select('invited_count')
        .eq('member_id', user.member_id);
        
      if (!error && data && Array.isArray(data)) {
        const total = data.reduce((sum, row) => sum + (row.invited_count || 0), 0);
        setUnreadInvites(total);
      } else {
        setUnreadInvites(0);
      }
    };
    
    fetchUnreadInvites();
  }, [user?.member_id]);

  // 查詢隊長待處理出賽名單
  const fetchCaptainPendingLineups = async () => {
    if (!user?.member_id || !user?.team_name) {
      setCaptainPendingLineups([]);
      return;
    }

    try {
      console.log('查詢隊長待處理名單開始, member_id:', user.member_id, 'team_name:', user.team_name);
      
      // 🔒 獲取登入團隊標識和名稱
      const loginTeamId = getLoginTeamId(user.member_id);
      const loginTeamName = await getTeamNameByTeamId(loginTeamId);
      
      if (!loginTeamName) {
        console.error('無法獲取登入團隊名稱');
        setCaptainPendingLineups([]);
        return;
      }
      
      // 🔒 重要：先查詢用戶是哪些隊伍的隊長
      const { data: captainTeams, error: captainTeamsError } = await supabase
        .from('contest_team_member')
        .select(`contest_team_id`)
        .eq('member_id', user.member_id)
        .eq('status', 'captain');

      if (captainTeamsError || !captainTeams || captainTeams.length === 0) {
        console.error('查詢用戶隊長身份失敗:', captainTeamsError);
        setCaptainPendingLineups([]);
        return;
      }

      // 獲取隊長的隊伍 ID 列表
      const userTeamIds = captainTeams.map(team => team.contest_team_id);
      console.log('用戶是這些隊伍的隊長:', userTeamIds);
      
      // 🔒 修正：同時查詢主賽事和子賽事的 contest_id
      
      // 1. 先獲取隊長參與的主賽事 contest_id
      const { data: teamContests, error: teamContestsError } = await supabase
        .from('contest_team')
        .select(`
          contest_id,
          contest:contest_id (
            team_name
          )
        `)
        .in('contest_team_id', userTeamIds);

      if (teamContestsError) {
        console.error('查詢隊伍所屬比賽失敗:', teamContestsError);
        setCaptainPendingLineups([]);
        return;
      }

      // 🔒 過濾出同登入團隊主辦的主賽事
      const filteredMainContests = (teamContests || []).filter((tc: any) => {
        const contestTeamName = tc.contest?.team_name;
        return contestTeamName === loginTeamName;
      });
      
      // 獲取主賽事的 contest_id
      const mainContestIds = [...new Set(filteredMainContests.map((tc: any) => tc.contest_id))];
      console.log('隊長參與的主賽事 contest_id:', mainContestIds);

      // 2. 🆕 查詢子賽事：透過 contest_group_assignment 找出隊長參與的子賽事
      let subContestIds: any[] = [];
      if (mainContestIds.length > 0) {
        // 查詢所有相關的子賽事
        const { data: allSubContests, error: subContestsError } = await supabase
          .from('contest')
          .select('contest_id, parent_contest_id, team_name')
          .in('parent_contest_id', mainContestIds)
          .eq('team_name', loginTeamName); // 同登入團隊主辦

        if (!subContestsError && allSubContests) {
          // 檢查隊長的隊伍是否被分配到這些子賽事
          for (const subContest of allSubContests) {
            const { data: assignments, error: assignError } = await supabase
              .from('contest_group_assignment')
              .select('contest_team_id')
              .eq('group_contest_id', subContest.contest_id)
              .in('contest_team_id', userTeamIds);

            if (!assignError && assignments && assignments.length > 0) {
              subContestIds.push(subContest.contest_id);
            }
          }
        }
      }
      
      console.log('隊長參與的子賽事 contest_id:', subContestIds);
      
      // 3. 合併主賽事和子賽事的 contest_id
      const captainContestIds = [...mainContestIds, ...subContestIds];
      console.log('隊長參與的所有比賽 contest_id:', captainContestIds);

      // 🔒 只查詢隊長參與的隊伍的比賽（有團隊區隔）
      const { data: allContestMatches, error: allMatchesError } = await supabase
        .from('contest_match')
        .select('match_id, contest_id, team1_id, team2_id, winner_team_id')
        .in('contest_id', captainContestIds)
        .or(`team1_id.in.(${userTeamIds.join(',')}),team2_id.in.(${userTeamIds.join(',')})`);

      if (allMatchesError || !allContestMatches || allContestMatches.length === 0) {
        console.error('查詢比賽失敗:', allMatchesError);
        setCaptainPendingLineups([]);
        return;
      }

      console.log('找到的所有比賽:', allContestMatches.length, '場');
      
      // 獲取所有比賽的陣容詳情，用於判斷雙方是否已安排名單
      const matchIds = allContestMatches.map((match: any) => match.match_id);
      const { data: matchDetails, error: matchDetailsError } = await supabase
        .from('contest_match_detail')
        .select('match_id, team1_member_ids, team2_member_ids')
        .in('match_id', matchIds);
        
      if (matchDetailsError) {
        console.error('獲取比賽陣容失敗:', matchDetailsError);
      }
      
      // 建立比賽ID到陣容詳情的映射
      const matchDetailMap = new Map<string, {team1_member_ids: any[], team2_member_ids: any[]}>();
      if (matchDetails) {
        matchDetails.forEach((detail: any) => {
          matchDetailMap.set(detail.match_id.toString(), {
            // 🔧 確保 JSONB 陣列正確處理
            team1_member_ids: Array.isArray(detail.team1_member_ids) ? detail.team1_member_ids : [],
            team2_member_ids: Array.isArray(detail.team2_member_ids) ? detail.team2_member_ids : []
          });
        });
      }
      
      console.log('各比賽陣容狀態:', matchDetailMap);
      
      // 🔒 不使用視圖，完全依靠 contest_match_detail 來判斷狀態
      // 如果 contest_match_detail 表中無記錄，表示還沒產出對戰單，不需要通知
      console.log('完全依靠 contest_match_detail 表來判斷比賽狀態，不使用視圖過濾');
      
      // 獲取所有相關隊伍的資訊
      const allTeamIds = [...new Set([
        ...allContestMatches.map((m: any) => m.team1_id), 
        ...allContestMatches.map((m: any) => m.team2_id)
      ])];
      
      const { data: teamsData, error: teamsError } = await supabase
        .from('contest_team')
        .select('contest_team_id, team_name')
        .in('contest_team_id', allTeamIds);
        
      if (teamsError || !teamsData) {
        console.error('獲取隊伍詳情失敗:', teamsError);
        setCaptainPendingLineups([]);
        return;
      }
      
      // 建立隊伍ID到隊伍名稱的映射
      const teamNameMap = new Map<string | number, string>();
      teamsData.forEach((team: any) => {
        teamNameMap.set(team.contest_team_id, team.team_name);
      });
      
      // 獲取所有相關contest詳情
      const { data: contestsData, error: contestsError } = await supabase
        .from('contest')
        .select('contest_id, contest_name, contest_status')
        .in('contest_id', captainContestIds);
        
      if (contestsError || !contestsData) {
        console.error('獲取比賽資訊失敗:', contestsError);
        setCaptainPendingLineups([]);
        return;
      }
      
      // 建立contest_id到contest資訊的映射
      const contestInfoMap = new Map<string | number, {contest_name: string, contest_status: string}>();
      contestsData.forEach((contest: any) => {
        contestInfoMap.set(contest.contest_id, {
          contest_name: contest.contest_name,
          contest_status: contest.contest_status || 'ongoing'
        });
      });
      
      // 處理要顯示的名單
      const displayLineups = [];
      
      // 🔒 只處理隊長參與的比賽，並且有 contest_match_detail 記錄的比賽
      for (const match of allContestMatches) {
        // 只過濾已結束的賽事，不考慮其他條件
        const contestInfo = contestInfoMap.get(match.contest_id);
        if (!contestInfo || contestInfo.contest_status === 'finished') {
          continue;
        }
        
        // 🔒 檢查是否有 contest_match_detail 記錄，沒有記錄表示還沒產出對戰單
        const matchDetail = matchDetailMap.get(match.match_id.toString());
        if (!matchDetail) {
          console.log(`比賽 ${match.match_id} 沒有對戰單記錄，跳過`);
          continue;
        }
        
        console.log(`判斷比賽 ${match.match_id} (賽事=${match.contest_id}) 狀態：${contestInfo.contest_status}`);
        
        // 🔒 查找隊長在此比賽的隊伍ID
        let captainTeamId = null;
        let teamType = null;
        
        for (const teamId of userTeamIds) {
          if (match.team1_id.toString() === teamId.toString()) {
            captainTeamId = teamId;
            teamType = 'team1';
            break;
          } else if (match.team2_id.toString() === teamId.toString()) {
            captainTeamId = teamId;
            teamType = 'team2';
            break;
          }
        }
        
        // 如果隊長不在這場比賽中，則跳過
        if (!captainTeamId) {
          continue;
        }
        
        // 確定對手隊伍ID和名稱
        const opponentTeamId = teamType === 'team1' ? match.team2_id : match.team1_id;
        const opponentTeamName = teamNameMap.get(opponentTeamId) || '未知隊伍';
        
        // 🔒 分析比賽的陣容詳情（已經在上面檢查過 matchDetail 存在）
        // 🔧 修正：正確處理 JSONB 陣列（可能是空陣列 [] 而不是 null）
        const team1HasLineup = Array.isArray(matchDetail.team1_member_ids) && matchDetail.team1_member_ids.length > 0;
        const team2HasLineup = Array.isArray(matchDetail.team2_member_ids) && matchDetail.team2_member_ids.length > 0;
        console.log(`比賽 ${match.match_id} 陣容狀態: team1=${team1HasLineup}, team2=${team2HasLineup}`);
        
        // 🔒 完全基於 contest_match_detail 判斷狀態
        // 檢查隊長隊伍和對手隊伍的安排狀態
        const captainTeamHasLineup = teamType === 'team1' ? team1HasLineup : team2HasLineup;
        const opponentTeamHasLineup = teamType === 'team1' ? team2HasLineup : team1HasLineup;
        
        // 確定名單狀態
        let readyStatus: 'not_ready' | 'ready' | 'both_ready' = 'not_ready';
        let isPending = false;
        
        if (!captainTeamHasLineup) {
          // 隊長隊伍未安排
          readyStatus = 'not_ready';
          isPending = true;
        } else if (captainTeamHasLineup && !opponentTeamHasLineup) {
          // 隊長隊伍已安排，對手未安排
          readyStatus = 'ready';
          isPending = false;
        } else if (captainTeamHasLineup && opponentTeamHasLineup) {
          // 雙方都已安排
          readyStatus = 'both_ready';
          isPending = false;
        }
        
        console.log(`比賽 ${match.match_id} 狀態判斷: 隊長=${captainTeamHasLineup}, 對手=${opponentTeamHasLineup}, 狀態=${readyStatus}`);
        
        // 添加到要顯示的名單
        displayLineups.push({
          match_id: match.match_id,
          contest_id: match.contest_id,
          team_type: teamType,
          contest_team_id: captainTeamId,
          opponent_team_name: opponentTeamName,
          contest_name: contestInfo.contest_name,
          pending: isPending, // 用於標記"未安排"
          contest_status: contestInfo.contest_status,
          readyStatus: readyStatus // 名單狀態
        });
      }
      
      console.log('處理後數據:', displayLineups);
      setCaptainPendingLineups(displayLineups);
      
    } catch (err) {
      console.error('查詢隊長待處理名單錯誤:', err);
      setCaptainPendingLineups([]);
    }
  };

  // 查詢隊長待處理的對戰名單
  const fetchPendingMatches = async () => {
    if (!user?.member_id) {
      setPendingLineups({ count: 0, matches: [] });
      return;
    }

    try {
      // 🔒 獲取登入團隊標識和名稱
      const loginTeamId = getLoginTeamId(user.member_id);
      const loginTeamName = await getTeamNameByTeamId(loginTeamId);
      
      if (!loginTeamName) {
        console.error('無法獲取登入團隊名稱');
        setPendingLineups({ count: 0, matches: [] });
        return;
      }
      
      // 查詢當前用戶是隊長的隊伍
      const { data: captainTeams, error: captainError } = await supabase
        .from('contest_team_member')
        .select(`
          contest_team_id,
          contest_team:contest_team_id (
            contest_team_id,
            team_name,
            contest_id,
            contest:contest_id (
              team_name
            )
          )
        `)
        .eq('member_id', user.member_id)
        .eq('status', 'captain');

      if (captainError || !captainTeams || captainTeams.length === 0) {
        setPendingLineups({ count: 0, matches: [] });
        return;
      }

      // 🔒 過濾出同登入團隊主辦的比賽中的隊伍
      const filteredCaptainTeams = captainTeams.filter((team: any) => {
        const contestTeamName = team.contest_team?.contest?.team_name;
        return contestTeamName === loginTeamName;
      });

      if (filteredCaptainTeams.length === 0) {
        setPendingLineups({ count: 0, matches: [] });
        return;
      }

      // 獲取隊長所在隊伍的ID列表（僅限同登入團隊的比賽）
      const teamIds = filteredCaptainTeams.map((team: any) => team.contest_team.contest_team_id);

      // 查詢作為 team1 且未設置陣容的比賽
      const { data: team1Matches, error: team1Error } = await supabase
        .from('contest_match')
        .select(`
          match_id,
          team1_id,
          team2_id,
          team1:team1_id (team_name),
          team2:team2_id (team_name),
          contest:contest_id (contest_name)
        `)
        .in('team1_id', teamIds)
        .is('team1_lineup_ready', false)
        .is('winner_team_id', null);

      // 查詢作為 team2 且未設置陣容的比賽
      const { data: team2Matches, error: team2Error } = await supabase
        .from('contest_match')
        .select(`
          match_id,
          team1_id,
          team2_id,
          team1:team1_id (team_name),
          team2:team2_id (team_name),
          contest:contest_id (contest_name)
        `)
        .in('team2_id', teamIds)
        .is('team2_lineup_ready', false)
        .is('winner_team_id', null);

      // 處理比賽資料並格式化為通知所需格式
      const matches = [];
      
      // 處理 team1 的比賽
      if (team1Matches) {
        for (const match of team1Matches) {
          matches.push({
            match_id: match.match_id,
            contest_name: match.contest?.contest_name || '未命名比賽',
            opponent_name: match.team2?.team_name || '對手隊伍',
            team_type: 'team1',
            contest_team_id: match.team1_id // 添加team1的contest_team_id
          });
        }
      }
      
      // 處理 team2 的比賽
      if (team2Matches) {
        for (const match of team2Matches) {
          matches.push({
            match_id: match.match_id,
            contest_name: match.contest?.contest_name || '未命名比賽',
            opponent_name: match.team1?.team_name || '對手隊伍',
            team_type: 'team2',
            contest_team_id: match.team2_id // 添加team2的contest_team_id
          });
        }
      }

      setPendingLineups({
        count: matches.length,
        matches: matches
      });
    } catch (err) {
      console.error('查詢比賽失敗:', err);
      setPendingLineups({ count: 0, matches: [] });
    }
  };

  useEffect(() => {
    // 首次載入及用戶變更時獲取資料
    fetchPendingMatches();
    fetchCaptainPendingLineups(); // 獲取隊長待處理名單
    fetchPendingMatchGeneration(); // 獲取管理員待產生對戰表的比賽
    fetchPendingContestFinish(); // 🎯 新增：獲取待確認結束的比賽
  }, [user?.member_id, user?.role, user?.team_name]);

  // 處理點擊前往編排名單 (修正函數，添加contest_team_id參數)
  const handleLineupClick = (matchId: string, teamType: string, contestTeamId: string) => {
    // 導航到編輯出賽名單頁面，帶上match_id和team_id參數 (contest_team_id)
    console.log(`導航到編輯頁面: match_id=${matchId}, team_id=${contestTeamId}`);
    navigate(`/contest/lineup-editor?match_id=${matchId}&team_id=${contestTeamId}`);
  };

  // 處理點擊前往賽程控制區
  const handleMatchGenerationClick = (contestId: number) => {
    console.log(`導航到賽程控制區: contest_id=${contestId}`);
    navigate(`/contest-control`);
  };

  // 設置實時訂閱，當有新比賽建立時更新通知
  useEffect(() => {
    if (!user?.member_id) return;

    // 訂閱 contest_match 表的更新
    const matchSubscription = supabase
      .channel('contest_match_changes')
      .on('postgres_changes', 
        { 
          event: 'INSERT', 
          schema: 'public', 
          table: 'contest_match' 
        }, 
        () => {
          // 當有新比賽建立時，重新獲取待處理比賽
          fetchPendingMatches();
          fetchCaptainPendingLineups(); // 重新獲取隊長待處理名單
        }
      )
      .subscribe();

    // 訂閱 contest 表的更新（監聽狀態變化）
    const contestSubscription = supabase
      .channel('contest_status_changes')
      .on('postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'contest'
        },
        () => {
          // 當比賽狀態更新時，重新獲取待產生對戰表的比賽和待確認結束的比賽
          fetchPendingMatchGeneration();
          fetchPendingContestFinish(); // 🎯 新增：重新獲取待確認結束的比賽
        }
      )
      .subscribe();

    // 🎯 新增：訂閱 contest_match_detail 表的更新（監聽比分變化）
    const matchDetailSubscription = supabase
      .channel('contest_match_detail_changes')
      .on('postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'contest_match_detail'
        },
        () => {
          // 當比分更新時，重新檢查待確認結束的比賽
          fetchPendingContestFinish();
        }
      )
      .subscribe();

    // 組件卸載時取消訂閱
    return () => {
      supabase.removeChannel(matchSubscription);
      supabase.removeChannel(contestSubscription);
      supabase.removeChannel(matchDetailSubscription); // 🎯 新增
    };
  }, [user?.member_id, user?.role, user?.team_name]);

  return (
    <div className="mb-6 p-4 bg-yellow-50 rounded shadow">
      {/* 顯示登入者的 member_id */}
      {user?.member_id && (
        <div className="text-xs text-gray-500 mb-1">
          登入者 ID: {user.member_id}
        </div>
      )}
      <h3 className="font-bold mb-2 text-lg">待處理事項</h3>
      <ul>
        <li 
          style={{cursor:'pointer', color: unreadChallenge > 0 ? '#d97706' : undefined}} 
          onClick={() => navigate('/challenges')}
        >
          挑戰通知：{unreadChallenge} 筆未讀
        </li>
        <li 
          style={{cursor:'pointer', color: unreadInvites > 0 ? '#2563eb' : undefined}} 
          onClick={() => navigate('/contest-invitations')}
        >
          賽程邀約：{unreadInvites} 筆待處理
        </li>
        
        {/* 管理員：顯示待產生對戰表的比賽 */}
        {user?.role === 'admin' && pendingMatchGeneration.map((contest) => (
          <li 
            key={`pending-match-gen-${contest.contest_id}`}
            style={{cursor:'pointer', color: '#dc2626', fontWeight: 'bold'}} 
            onClick={() => handleMatchGenerationClick(contest.contest_id)}
          >
            請前往產生「{contest.contest_name}」的對戰表
          </li>
        ))}
        
        {/* 🎯 新增：顯示待確認結束的比賽 */}
        {pendingContestFinish.map((contest) => (
          <li 
            key={`pending-contest-finish-${contest.contest_id}`}
            style={{cursor:'pointer', color: '#dc2626', fontWeight: 'bold'}} 
            onClick={handleContestFinishClick}
          >
            請至賽程控制區確認「{contest.contest_name}」比賽已結束
          </li>
        ))}
        
        {/* 顯示需要填入出賽名單的比賽 (修改onClick以傳遞contest_team_id) */}
        {pendingLineups.matches.map((match) => (
          <li 
            key={match.match_id}
            style={{cursor:'pointer', color: '#dc2626'}} 
            onClick={() => handleLineupClick(match.match_id, match.team_type, match.contest_team_id)}
          >
            請前往編排對戰{match.opponent_name}的出賽名單（{match.contest_name}）
          </li>
        ))}
        
        {/* 顯示隊長待處理名單 (修改onClick以傳遞contest_team_id) */}
        {captainPendingLineups && captainPendingLineups.length > 0 && captainPendingLineups.map((lineup) => {
          // 根據名單狀態設置樣式
          let itemStyle: { fontWeight: 'bold', color: string } = { 
            fontWeight: 'bold',
            color: '#dc2626' // 預設紅色
          };
          let canClick = true;
          let statusText = '';
          
          if (lineup.readyStatus === 'not_ready') {
            // 未安排，紅色
            itemStyle.color = '#dc2626';
            statusText = lineup.pending ? '(未安排)' : '';
          } else if (lineup.readyStatus === 'ready') {
            // 已安排，對手未安排，綠色
            itemStyle.color = '#16a34a';
            statusText = '(已安排)';
          } else if (lineup.readyStatus === 'both_ready') {
            // 雙方都已安排，灰色，不可點擊
            itemStyle.color = '#9ca3af';
            canClick = false;
            statusText = '(雙方已安排)';
          }
          
          return (
            <li 
              key={`captain-pending-${lineup.match_id}`}
              style={{
                ...itemStyle,
                cursor: canClick ? 'pointer' : 'default'
              }} 
              onClick={canClick ? () => handleLineupClick(lineup.match_id, lineup.team_type, lineup.contest_team_id) : undefined}
            >
              請編輯對戰{lineup.opponent_team_name}出賽名單（{lineup.contest_name}）{statusText}
            </li>
          );
        })}

      </ul>
    </div>
  );
};

export default NewTodoBlock;