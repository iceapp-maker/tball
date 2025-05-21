import React, { useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserContext } from '../UserContext';
import { supabase } from '../supabaseClient';

const NewTodoBlock: React.FC = () => {
  const { user } = useContext(UserContext) ?? { user: null };
  const navigate = useNavigate();
  const [unreadChallenge, setUnreadChallenge] = useState(0);
  const [unreadInvites, setUnreadInvites] = useState(0);
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
    if (!user?.member_id) {
      setCaptainPendingLineups([]);
      return;
    }

    try {
      console.log('查詢隊長待處理名單開始, member_id:', user.member_id);
      
      // 重要：先查詢用戶是哪些隊伍的隊長
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
      
      // 獲取隊長所有參與的比賽
      interface CaptainMatch {
        match_id: string;
        contest_id: string | number;
        team1_id: string | number;
        team2_id: string | number;
        winner_team_id: string | number | null;
      }
      
      let captainMatches: CaptainMatch[] = [];
      
      // 查詢隊長所在team1的比賽
      for (const teamId of userTeamIds) {
        const { data: team1Matches, error: team1Error } = await supabase
          .from('contest_match')
          .select('match_id, contest_id, team1_id, team2_id, winner_team_id')
          .eq('team1_id', teamId);
          
        if (!team1Error && team1Matches) {
          captainMatches = [...captainMatches, ...team1Matches];
        }
      }
      
      // 查詢隊長所在team2的比賽
      for (const teamId of userTeamIds) {
        const { data: team2Matches, error: team2Error } = await supabase
          .from('contest_match')
          .select('match_id, contest_id, team1_id, team2_id, winner_team_id')
          .eq('team2_id', teamId);
          
        if (!team2Error && team2Matches) {
          captainMatches = [...captainMatches, ...team2Matches];
        }
      }
      
      // 如果沒有找到任何比賽，退出
      if (!captainMatches.length) {
        console.log('沒有找到隊長相關的比賽');
        setCaptainPendingLineups([]);
        return;
      }
      
      // 獲取所有相關的 contest_id
      const contestIds = [...new Set(captainMatches.map(match => match.contest_id))];
      
      // 獲取這些 contest 的所有比賽
      const { data: allContestMatches, error: allMatchesError } = await supabase
        .from('contest_match')
        .select('match_id, contest_id, team1_id, team2_id, winner_team_id')
        .in('contest_id', contestIds);
        
      if (allMatchesError || !allContestMatches) {
        console.error('獲取賽事所有比賽失敗:', allMatchesError);
        setCaptainPendingLineups([]);
        return;
      }
      
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
            team1_member_ids: detail.team1_member_ids || [],
            team2_member_ids: detail.team2_member_ids || []
          });
        });
      }
      
      console.log('各比賽陣容狀態:', matchDetailMap);
      
      // 獲取未安排的比賽（用於標記"未安排"）
      const { data: pendingMatches, error: pendingError } = await supabase
        .from('vw_captains_with_pending_lineups')
        .select('*')
        .eq('member_id', user.member_id);
        
      console.log('未安排的比賽資訊:', pendingMatches);
        
      // 建立未安排比賽的映射
      const pendingMatchMap = new Map<string, boolean>();
      if (!pendingError && pendingMatches && pendingMatches.length > 0) {
        pendingMatches.forEach((match: any) => {
          // 將match_id作為鍜，加入映射中
          pendingMatchMap.set(match.match_id.toString(), true);
          console.log('加入未安排名單:', match.match_id);
        });
      } else {
        console.log('無未安排的比賽或查詢失敗:', pendingError);
      }
      
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
        .in('contest_id', contestIds);
        
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
      
      // 過濾掉隊長不相關的比賽，只保留隊長參與的賽事中的比賽
      for (const match of allContestMatches) {
        // 只過濾已結束的賽事，不考慮其他條件
        const contestInfo = contestInfoMap.get(match.contest_id);
        if (!contestInfo || contestInfo.contest_status === 'finished') {
          continue;
        }
        console.log(`判斷比賽 ${match.match_id} (賽事=${match.contest_id}) 狀態：${contestInfo.contest_status}`);
        
        // 查找隊長在此比賽的隊伍ID
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
        
        // 獲取比賽的陣容詳情
        const matchDetail = matchDetailMap.get(match.match_id.toString());
        let team1HasLineup = false;
        let team2HasLineup = false;
        
        if (matchDetail) {
          team1HasLineup = matchDetail.team1_member_ids && matchDetail.team1_member_ids.length > 0;
          team2HasLineup = matchDetail.team2_member_ids && matchDetail.team2_member_ids.length > 0;
          console.log(`比賽 ${match.match_id} 陣容狀態: team1=${team1HasLineup}, team2=${team2HasLineup}`);
        }
        
        // 檢查是否在待處理名單中（用於標記"未安排"）
        const isPending = pendingMatchMap.has(match.match_id.toString());
        console.log(`檢查比賽 ${match.match_id} 是否在未安排列表中:`, isPending);
        
        // 確定名單狀態
        let readyStatus: 'not_ready' | 'ready' | 'both_ready' = 'not_ready';
        
        if (isPending) {
          // 如果在待處理名單中，則為未安排
          readyStatus = 'not_ready';
        } else {
          // 檢查隊長隊伍和對手隊伍的安排狀態
          const captainTeamHasLineup = teamType === 'team1' ? team1HasLineup : team2HasLineup;
          const opponentTeamHasLineup = teamType === 'team1' ? team2HasLineup : team1HasLineup;
          
          if (captainTeamHasLineup && opponentTeamHasLineup) {
            // 雙方都已安排
            readyStatus = 'both_ready';
          } else if (captainTeamHasLineup) {
            // 只有隊長隊伍已安排
            readyStatus = 'ready';
          } else {
            // 隊長隊伍未安排（應該不會發生，因為在待處理列表中服應已被捕獲）
            readyStatus = 'not_ready';
          }
        }
        
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
      // 查詢當前用戶是隊長的隊伍
      const { data: captainTeams, error: captainError } = await supabase
        .from('contest_team_member')
        .select(`
          contest_team_id,
          contest_team:contest_team_id (
            contest_team_id,
            team_name,
            contest_id
          )
        `)
        .eq('member_id', user.member_id)
        .eq('status', 'captain');

      if (captainError || !captainTeams || captainTeams.length === 0) {
        setPendingLineups({ count: 0, matches: [] });
        return;
      }

      // 獲取隊長所在隊伍的ID列表
      const teamIds = captainTeams.map(team => team.contest_team.contest_team_id);

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
    
    // 設定定期檢查，每分鐘檢查一次
    const intervalId = setInterval(() => {
      fetchPendingMatches();
      fetchCaptainPendingLineups(); // 定期獲取隊長待處理名單
    }, 60000);
    
    // 組件卸載時清除定時器
    return () => clearInterval(intervalId);
  }, [user?.member_id]);

  // 處理點擊前往編排名單 (修正函數，添加contest_team_id參數)
  const handleLineupClick = (matchId: string, teamType: string, contestTeamId: string) => {
    // 導航到編輯出賽名單頁面，帶上match_id和team_id參數 (contest_team_id)
    console.log(`導航到編輯頁面: match_id=${matchId}, team_id=${contestTeamId}`);
    navigate(`/contest/lineup-editor?match_id=${matchId}&team_id=${contestTeamId}`);
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

    // 組件卸載時取消訂閱
    return () => {
      supabase.removeChannel(matchSubscription);
    };
  }, [user?.member_id]);

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