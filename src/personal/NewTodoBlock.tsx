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
    contest_team_id: string; // 添加隊伍的 contest_team_id
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
      
      // 查詢隊長待處理名單的視圖
      const { data, error } = await supabase
        .from('vw_captains_with_pending_lineups')
        .select('*')
        .eq('member_id', user.member_id);

      if (error) {
        console.error('查詢隊長待處理名單失敗:', error);
        setCaptainPendingLineups([]);
        return;
      }

      console.log('查詢結果:', data);

      if (data && Array.isArray(data)) {
        // 獲取所有比賽ID
        const matchIds = data.map(item => item.match_id).filter(Boolean);
        
        // 獲取比賽的詳細資訊，包括contest_id和team_id
        const { data: matchesData, error: matchesError } = await supabase
          .from('contest_match')
          .select('match_id, contest_id, team1_id, team2_id, team1:team1_id(team_name), team2:team2_id(team_name)')
          .in('match_id', matchIds);
          
        if (matchesError) {
          console.error('獲取比賽詳情失敗:', matchesError);
          return;
        }
        
        // 建立match_id到contest_id的映射和team_type到team_id的映射
        const matchInfoMap = new Map();
        matchesData?.forEach(match => {
          matchInfoMap.set(match.match_id, {
            contest_id: match.contest_id,
            team1_id: match.team1_id,
            team2_id: match.team2_id,
            team1_name: match.team1?.team_name,
            team2_name: match.team2?.team_name
          });
        });
        
        // 獲取所有相關的contest詳情
        const contestIds = Array.from(matchInfoMap.values()).map(info => info.contest_id).filter(Boolean);
        
        const { data: contestsData, error: contestsError } = await supabase
          .from('contest')
          .select('contest_id, contest_name')
          .in('contest_id', contestIds);
          
        if (contestsError) {
          console.error('獲取比賽名稱失敗:', contestsError);
          return;
        }
        
        // 建立contest_id到contest_name的映射
        const contestNameMap = new Map();
        contestsData?.forEach(contest => {
          contestNameMap.set(contest.contest_id, contest.contest_name);
        });

        // 確保正確映射數據 - 關鍵改動：根據用戶是哪個隊伍的隊長來決定team_type和contest_team_id
        const mappedData = data.map(item => {
          const matchInfo = matchInfoMap.get(item.match_id) || {};
          const contestId = matchInfo.contest_id;
          const contestName = contestId ? contestNameMap.get(contestId) : '未知比賽';
          
          // 檢查用戶是team1還是team2的隊長
          const team1Id = matchInfo.team1_id?.toString() || '';
          const team2Id = matchInfo.team2_id?.toString() || '';
          
          // 根據用戶是哪支隊伍的隊長，確定team_type和contest_team_id
          const isTeam1 = userTeamIds.some(id => id.toString() === team1Id);
          const isTeam2 = userTeamIds.some(id => id.toString() === team2Id);
          
          // 根據結果決定team_type和contest_team_id
          let team_type = 'unknown';
          let contestTeamId = '';
          let opponentName = '';
          
          if (isTeam1) {
            team_type = 'team1';
            contestTeamId = team1Id;
            opponentName = matchInfo.team2_name || '對手隊伍';
          } else if (isTeam2) {
            team_type = 'team2';
            contestTeamId = team2Id;
            opponentName = matchInfo.team1_name || '對手隊伍';
          } else {
            console.warn('用戶不是這場比賽任何一方的隊長:', item.match_id);
            // 此情況不應發生，但為安全起見，使用視圖返回的資訊
            team_type = item.team_type || 'team1';
            contestTeamId = team_type === 'team1' ? team1Id : team2Id;
            opponentName = item.opponent_team_name || '未知隊伍';
          }
          
          return {
            match_id: item.match_id || '',
            opponent_team_name: opponentName,
            team_type: team_type,
            contest_name: contestName || '未知比賽',
            contest_team_id: contestTeamId // 確保傳入的是登入者的隊伍ID
          };
        });
        
        console.log('處理後數據:', mappedData);
        setCaptainPendingLineups(mappedData);
      } else {
        setCaptainPendingLineups([]);
      }
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
        {captainPendingLineups && captainPendingLineups.length > 0 && captainPendingLineups.map((lineup) => (
          <li 
            key={`captain-pending-${lineup.match_id}`}
            style={{cursor:'pointer', color: '#dc2626', fontWeight: 'bold'}} 
            onClick={() => handleLineupClick(lineup.match_id, lineup.team_type, lineup.contest_team_id)}
          >
            請編輯對戰{lineup.opponent_team_name}出賽名單（{lineup.contest_name}）
          </li>
        ))}
      </ul>
    </div>
  );
};

export default NewTodoBlock;