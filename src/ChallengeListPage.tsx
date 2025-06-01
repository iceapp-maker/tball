import React from 'react';
import { supabase } from './supabaseClient';
import { UserContext } from './UserContext';
import StatusSwitch from './utils/StatusSwitch';
import { useNavigate } from 'react-router-dom';

interface ChallengeDetail {
  challenge_id: number;
  initiator: string;
  player1?: string;
  player2?: string;
  player3?: string;
  player4?: string;
  game_type: string;
  time_slot: string;
  created_at: string;
  status_code?: string;
  status_log?: any;
  challenge_date?: string;
  match_detail_id?: number;
}

export default function ChallengeListPage() {
  const { user } = React.useContext(UserContext) ?? { user: null };
  const [receivedChallenges, setReceivedChallenges] = React.useState<ChallengeDetail[]>([]);
  const [initiatedChallenges, setInitiatedChallenges] = React.useState<ChallengeDetail[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [actionLoading, setActionLoading] = React.useState<number|null>(null);
  const navigate = useNavigate();
  
  // 會員列表（含id與name）
  const [members, setMembers] = React.useState<{ id: string; name: string; team_id: string }[]>([]);
  // 當前團隊所有成員名單 - 新增
  const [teamMemberNames, setTeamMemberNames] = React.useState<string[]>([]);
  // 儲存比賽名稱映射 (match_detail_id -> contest_name)
  const [contestNames, setContestNames] = React.useState<Record<number, string>>({});
  const [matchDetailToContestMap, setMatchDetailToContestMap] = React.useState<Record<number, number>>({});
  // 儲存隊伍資訊映射 (match_detail_id -> team info)
  const [teamInfoMap, setTeamInfoMap] = React.useState<Record<number, {
    team1_id?: number;
    team2_id?: number;
    team1_name?: string;
    team2_name?: string;
    team1_members?: string[];
    team2_members?: string[];
  }>>({});
  // 保存玩家ID格式映射
  const [playerIdMap, setPlayerIdMap] = React.useState<Record<string, {
    shortId?: string;
    name?: string;
  }>>({});

  // 修正：獲取會員列表並建立團隊成員名單
  React.useEffect(() => {
    async function fetchMembers() {
      if (!user?.team_id) return;
      
      console.log('開始獲取團隊成員，team_id:', user.team_id);
      
      const { data, error } = await supabase
        .from('members')
        .select('id, name, team_id')
        .eq('team_id', user.team_id);
      
      if (error) {
        console.error('獲取團隊成員失敗:', error);
        return;
      }
      
      if (data) {
        setMembers(data);
        // 建立團隊成員名單陣列
        const memberNames = data.map(member => member.name);
        setTeamMemberNames(memberNames);
        console.log('團隊成員名單:', memberNames);
      }
    }
    fetchMembers();
  }, [user?.team_id]);

  // 修正：玩家ID映射（已經有team_id限制，保持不變）
  React.useEffect(() => {
    async function fetchPlayerIdMapping() {
      if (!user?.team_id) return;
      try {
        const { data, error } = await supabase
          .from('members')
          .select('id, name, member_id, team_id')
          .eq('team_id', user.team_id)
          .order('name', { ascending: true });

        if (error) {
          console.error('獲取成員ID映射錯誤:', error);
          return;
        }

        if (data && data.length > 0) {
          const idMapping: Record<string, {shortId?: string; name?: string}> = {};
          data.forEach(member => {
            idMapping[member.name] = {
              shortId: member.member_id || member.id,
              name: member.name
            };
          });
          setPlayerIdMap(idMapping);
          console.log('玩家ID映射:', idMapping);
        }
      } catch (err) {
        console.error('查詢玩家ID映射失敗:', err);
      }
    }
    
    fetchPlayerIdMapping();
  }, [user?.team_id]);
  
  // 比賽名稱映射（保持不變）
  React.useEffect(() => {
    async function fetchContestNames() {
      if (!user) return;
      console.log('開始查詢比賽資料...');
      
      const { data: statusLogs, error: logsError } = await supabase
        .from('challenge_status_logs')
        .select('match_detail_id')
        .not('match_detail_id', 'is', null);
      
      console.log('從 challenge_status_logs 表查詢到的資料:', statusLogs);
      
      if (!statusLogs || statusLogs.length === 0) {
        console.log('沒有找到任何帶有 match_detail_id 的記錄');
        return;
      }
      
      const matchDetailIds = statusLogs
        .map((log: any) => {
          const mdId = log.match_detail_id;
          return mdId ? Number(mdId) : null;
        })
        .filter(Boolean) as number[];
      
      console.log('提取的 match_detail_id 列表:', matchDetailIds);
      
      if (matchDetailIds.length === 0) {
        console.log('所有 match_detail_id 都是無效的');
        return;
      }
      
      const { data: matchDetails, error: matchDetailError } = await supabase
        .from('contest_match_detail')
        .select('match_detail_id, match_id, contest_id')
        .in('match_detail_id', matchDetailIds);
      
      console.log('從 contest_match_detail 表查詢到的資料:', matchDetails);
      
      if (!matchDetails || matchDetails.length === 0) {
        console.log('沒有在 contest_match_detail 表中找到記錄');
        return;
      }
      
      const matchIds = matchDetails.map((detail: any) => detail.match_id).filter(Boolean);
      
      const { data: matchData, error: matchError } = await supabase
        .from('contest_match')
        .select('match_id, team1_id, team2_id')
        .in('match_id', matchIds);
      
      if (matchError || !matchData) {
        console.error('查詢 contest_match 表錯誤:', matchError);
        return;
      }
      
      const teamIds = matchData.flatMap((match: any) => [match.team1_id, match.team2_id]).filter(Boolean);
      
      const { data: teamData, error: teamError } = await supabase
        .from('contest_team')
        .select('contest_team_id, team_name')
        .in('contest_team_id', teamIds);
      
      if (teamError || !teamData) {
        console.error('查詢隊伍資料錯誤:', teamError);
        return;
      }
      
      const mdToContestIdMap: Record<number, number> = {};
      const nameMap: Record<number, string> = {};
      const teamInfo: Record<number, any> = {};
      
      const matchToTeamsMap: Record<number, {team1_id?: number, team2_id?: number}> = {};
      matchData.forEach((match: any) => {
        matchToTeamsMap[match.match_id] = {
          team1_id: match.team1_id,
          team2_id: match.team2_id
        };
      });
      
      const teamIdToNameMap: Record<number, string> = {};
      teamData.forEach((team: any) => {
        teamIdToNameMap[team.contest_team_id] = team.team_name;
      });
      
      matchDetails.forEach((detail: any) => {
        const mdId = detail.match_detail_id;
        const matchId = detail.match_id;
        const contestId = detail.contest_id;
        
        if (mdId && contestId) {
          mdToContestIdMap[mdId] = contestId;
          
          if (matchToTeamsMap[matchId]) {
            const team1Id = matchToTeamsMap[matchId].team1_id;
            const team2Id = matchToTeamsMap[matchId].team2_id;
            
            teamInfo[mdId] = {
              team1_id: team1Id,
              team2_id: team2Id,
              team1_name: team1Id ? teamIdToNameMap[team1Id] : undefined,
              team2_name: team2Id ? teamIdToNameMap[team2Id] : undefined,
              team1_members: [],
              team2_members: []
            };
          }
        }
      });
      
      const allChallenges = [...receivedChallenges, ...initiatedChallenges];
      allChallenges.forEach(ch => {
        if (ch.match_detail_id && teamInfo[ch.match_detail_id]) {
          if (ch.player1 || ch.player2) {
            teamInfo[ch.match_detail_id].team1_members = [
              ch.player1, 
              ch.player2
            ].filter(Boolean) as string[];
          }
          
          if (ch.player3 || ch.player4) {
            teamInfo[ch.match_detail_id].team2_members = [
              ch.player3, 
              ch.player4
            ].filter(Boolean) as string[];
          }
        }
      });
      
      const { data: contests, error: contestsError } = await supabase
        .from('contest')
        .select('contest_id, contest_name')
        .in('contest_id', Object.values(mdToContestIdMap));
      
      if (contestsError) {
        console.error('查詢比賽錯誤:', contestsError);
        return;
      }

      for (const mdId of matchDetailIds) {
        const contestId = mdToContestIdMap[mdId];
        if (contestId) {
          const contest = contests.find((c: any) => c.contest_id === contestId);
          if (contest) {
            nameMap[mdId] = contest.contest_name;
            console.log(`建立映射: match_detail_id ${mdId} -> contest_id ${contestId} -> name ${contest.contest_name}`);
          }
        }
      }
      
      console.log('最終的名稱映射:', nameMap);
      console.log('隊伍信息映射:', teamInfo);
      
      setContestNames(nameMap);
      setMatchDetailToContestMap(mdToContestIdMap);
      setTeamInfoMap(teamInfo);
    }
    
    fetchContestNames();
  }, [user]);

  // 修正：增加錯誤處理和調試資訊
  const fetchAll = React.useCallback(async () => {
    if (!user?.team_id) {
      console.log('等待用戶資料載入，user.team_id:', user?.team_id);
      setLoading(false); // 如果沒有 team_id，停止載入狀態
      return;
    }
    
    setLoading(true);
    console.log('開始查詢，用戶 team_id:', user.team_id);
    
    try {
      // 步驟1：從 courts 表獲取 team_name，增加錯誤處理
      console.log('正在查詢 courts 表...');
      const { data: courtData, error: courtError } = await supabase
        .from('courts')
        .select('team_id, name')
        .eq('team_id', user.team_id);
      
      console.log('Courts 查詢結果:', { courtData, courtError });
      
      if (courtError) {
        console.error('查詢 courts 表失敗:', courtError);
        setLoading(false);
        return;
      }
      
      if (!courtData || courtData.length === 0) {
        console.warn('在 courts 表中找不到對應的 team_id:', user.team_id);
        // 如果找不到對應的 courts 記錄，可能需要其他處理方式
        // 嘗試直接使用 team_id 作為 team_name，或顯示空結果
        setReceivedChallenges([]);
        setInitiatedChallenges([]);
        setLoading(false);
        return;
      }
      
      const userTeamName = courtData[0].name; // 取第一筆記錄的 name
      console.log('用戶的 team_id:', user.team_id, '對應的 team_name:', userTeamName);
      
      // 步驟2：查詢挑戰
      console.log('正在查詢收到的挑戰...');
      const { data: receivedData, error: receivedError } = await supabase
        .from('challenges')
        .select('*, status_code')
        .eq('team_name', userTeamName)
        .or(`player1.eq.${user.name},player2.eq.${user.name},player3.eq.${user.name},player4.eq.${user.name}`)
        .order('created_at', { ascending: false });
      
      console.log('收到的挑戰查詢結果:', { count: receivedData?.length || 0, error: receivedError });
      
      if (receivedError) {
        console.error('查詢收到的挑戰失敗:', receivedError);
      }
      
      // 步驟3：查詢發起的挑戰
      console.log('正在查詢發起的挑戰...');
      const { data: initiatedData, error: initiatedError } = await supabase
        .from('challenges')
        .select('*, status_code')
        .eq('team_name', userTeamName)
        .eq('initiator', user.name)
        .order('created_at', { ascending: false });
      
      console.log('發起的挑戰查詢結果:', { count: initiatedData?.length || 0, error: initiatedError });
      
      if (initiatedError) {
        console.error('查詢發起的挑戰失敗:', initiatedError);
      }
      
      // 步驟4：整合 status_log
      console.log('正在整合 status_log...');
      const allChallenges = [...(receivedData || []), ...(initiatedData || [])];
      const statusCodes = allChallenges.map(ch => ch.status_code).filter(Boolean);
      let logsMap: Record<string, any> = {};
      
      if (statusCodes.length > 0) {
        console.log('查詢 status_logs，status_codes:', statusCodes);
        const { data: logs, error: logsError } = await supabase
          .from('challenge_status_logs')
          .select('*')
          .in('status_code', statusCodes);
        
        console.log('Status logs 查詢結果:', { count: logs?.length || 0, error: logsError });
        
        if (logs && !logsError) {
          logsMap = logs.reduce((acc, log) => {
            acc[log.status_code] = log;
            return acc;
          }, {} as Record<string, any>);
        }
      }
      
      // 步驟5：自動更新發起人狀態（保持原邏輯）
      for (const ch of initiatedData || []) {
        const playerFields = [
          { key: 'player1', status: 'player1_status' },
          { key: 'player2', status: 'player2_status' },
          { key: 'player3', status: 'player3_status' },
          { key: 'player4', status: 'player4_status' },
        ];
        for (const { key, status } of playerFields) {
          if (ch.initiator && ch[key] && ch.initiator === ch[key]) {
            const logRow = logsMap[ch.status_code];
            if (logRow && logRow[status] !== '已接受' && logRow[status] !== '收回') {
              const updateObj: any = {};
              updateObj[status] = '已接受';
              await supabase
                .from('challenge_status_logs')
                .update(updateObj)
                .eq('log_id', logRow.log_id);
            }
          }
        }
      }
      
      // 步驟6：設定最終結果
      console.log('設定最終結果...');
      setReceivedChallenges((receivedData || []).map((ch: ChallengeDetail) => ({ 
        ...ch, 
        status_log: logsMap[ch.status_code || ''] || {} 
      })));
      setInitiatedChallenges((initiatedData || []).map((ch: ChallengeDetail) => ({ 
        ...ch, 
        status_log: logsMap[ch.status_code || ''] || {} 
      })));
      
      console.log('挑戰查詢完成 - 收到:', receivedData?.length || 0, '發起:', initiatedData?.length || 0);
      
    } catch (error) {
      console.error('fetchAll 過程中發生未預期錯誤:', error);
    } finally {
      setLoading(false);
    }
  }, [user]);

  // 修正：依賴更新，移除對 teamMemberNames 的依賴
  React.useEffect(() => {
    if (!user) return;
    fetchAll();
  }, [user, fetchAll]);

  // 工具函數：判斷挑戰是否過期（保持不變）
  function isExpired(challenge: ChallengeDetail) {
    const dateStr = (challenge as any).challenge_date || challenge.created_at;
    if (!dateStr) return false;
    const challengeDate = new Date(dateStr.split('T')[0]);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return challengeDate < today;
  }

  // 狀態符號函數（移除收回相關）
  function getStatusSymbol_v4(status?: string) {
    if (status === '已接受') return '✅';
    if (status === '已拒絕') return '❌';
    return '⏳';
  }

  // 狀態 badge 樣式（移除收回相關）
  function renderStatus(status?: string) {
    const style = {
      display: 'inline-block',
      padding: '2px 12px',
      borderRadius: '999px',
      fontWeight: 600,
      fontSize: 14,
      letterSpacing: 1,
      background: '#f2f2f2',
      margin: '0 2px',
    } as React.CSSProperties;
    if (status === '已接受') return <span style={{ ...style, color: '#22b573', background: '#e8f9f1', border: '1px solid #22b573' }}>已接受</span>;
    if (status === '已拒絕') return <span style={{ ...style, color: '#d7263d', background: '#fde7ea', border: '1px solid #d7263d' }}>已拒絕</span>;
    return <span style={{ ...style, color: '#888', background: '#f5f5f5', border: '1px solid #ccc' }}>未讀取</span>;
  }

  // 新增：刪除挑戰函數
  const handleDeleteChallenge = async (ch: ChallengeDetail) => {
    setActionLoading(ch.challenge_id);
    
    try {
      console.log('開始刪除挑戰:', ch.challenge_id);
      
      // 確認對話框
      const confirmMsg = '確定要刪除這個挑戰嗎？此操作無法復原！';
      if (!window.confirm(confirmMsg)) {
        setActionLoading(null);
        return;
      }
      
      // 1. 先刪除 challenge_status_logs 相關記錄
      if (ch.status_code) {
        console.log('正在刪除 challenge_status_logs 記錄，status_code:', ch.status_code);
        const { error: logsDeleteError } = await supabase
          .from('challenge_status_logs')
          .delete()
          .eq('status_code', ch.status_code);
        
        if (logsDeleteError) {
          console.error('刪除 challenge_status_logs 失敗:', logsDeleteError);
          alert('刪除失敗：無法刪除狀態記錄');
          setActionLoading(null);
          return;
        }
        console.log('成功刪除 challenge_status_logs 記錄');
      }
      
      // 2. 刪除主要的 challenges 記錄
      console.log('正在刪除 challenges 記錄，challenge_id:', ch.challenge_id);
      const { error: challengeDeleteError } = await supabase
        .from('challenges')
        .delete()
        .eq('challenge_id', ch.challenge_id);
      
      if (challengeDeleteError) {
        console.error('刪除 challenges 失敗:', challengeDeleteError);
        alert('刪除失敗：' + challengeDeleteError.message);
        setActionLoading(null);
        return;
      }
      
      console.log('成功刪除 challenges 記錄');
      
      // 3. 立即更新前端狀態，移除被刪除的挑戰
      setReceivedChallenges(prev => prev.filter(rc => rc.challenge_id !== ch.challenge_id));
      setInitiatedChallenges(prev => prev.filter(ic => ic.challenge_id !== ch.challenge_id));
      
      // 4. 更新本地計數
      const updateLocalCount = () => {
        const pendingCount = receivedChallenges.filter((challenge: ChallengeDetail) => {
          if (challenge.challenge_id === ch.challenge_id) return false; // 排除被刪除的
          
          let playerField = '';
          if (user.name === challenge.player1) playerField = 'player1_status';
          else if (user.name === challenge.player2) playerField = 'player2_status';
          else if (user.name === challenge.player3) playerField = 'player3_status';
          else if (user.name === challenge.player4) playerField = 'player4_status';
          else return false;
          const status = challenge.status_log?.[playerField];
          return !status || status === '未讀取';
        }).length;
        localStorage.setItem('pendingChallengeCount', String(pendingCount));
        window.dispatchEvent(new Event('storage'));
        const updateEvent = new Event('updateNotificationCount');
        window.dispatchEvent(updateEvent);
      };
      updateLocalCount();
      
      alert('挑戰已成功刪除！');
      
    } catch (error) {
      console.error('刪除挑戰時發生未預期錯誤:', error);
      alert('刪除失敗：系統錯誤');
    } finally {
      setActionLoading(null);
    }
  };

  // 接受/拒絕挑戰函數（移除收回選項）
  const handleAction = async (ch: ChallengeDetail, action: string) => {
    setActionLoading(ch.challenge_id);
    let playerField = '';
    if (user.name === ch.player1) playerField = 'player1_status';
    else if (user.name === ch.player2) playerField = 'player2_status';
    else if (user.name === ch.player3) playerField = 'player3_status';
    else if (user.name === ch.player4) playerField = 'player4_status';
    else return;
    
    // 立即前端同步更新（Optimistic UI）
    setReceivedChallenges(prev => prev.map(rc => {
      if (rc.challenge_id === ch.challenge_id) {
        return {
          ...rc,
          status_log: {
            ...rc.status_log,
            [playerField]: action
          }
        };
      }
      return rc;
    }));
    
    // 資料庫更新
    const { data: logRow } = await supabase
      .from('challenge_status_logs')
      .select('log_id')
      .eq('status_code', ch.status_code)
      .maybeSingle();
    if (!logRow) {
      setActionLoading(null);
      return;
    }
    const updateObj: any = {};
    updateObj[playerField] = action;
    const { data, error } = await supabase
      .from('challenge_status_logs')
      .update(updateObj)
      .eq('log_id', logRow.log_id);
    if (error) {
      alert('更新狀態失敗：' + error.message);
      console.error('Supabase update error:', error);
    } else {
      console.log('狀態更新成功', updateObj);

      // 如果接受挑戰且有 match_detail_id，更新 contest_match_detail 的隊伍 ID
      if (action === '已接受' && ch.match_detail_id) {
        console.log('DEBUG ChallengeListPage: 接受挑戰，開始更新 contest_match_detail 的隊伍 ID');
        
        let team1IdToUpdate: string | null = null;
        let team2IdToUpdate: string | null = null;

        const getMemberTeamId = (playerName: string | undefined) => {
            if (!playerName) return null;
            const member = members.find(m => m.name === playerName);
            return member ? member.team_id : null;
        };

        if (ch.game_type === 'single') {
            team1IdToUpdate = getMemberTeamId(ch.player1);
            team2IdToUpdate = getMemberTeamId(ch.player2);
        } else if (ch.game_type === 'double') {
            team1IdToUpdate = getMemberTeamId(ch.player1) || getMemberTeamId(ch.player2);
            team2IdToUpdate = getMemberTeamId(ch.player3) || getMemberTeamId(ch.player4);
        }

        console.log('DEBUG ChallengeListPage: 根據挑戰玩家確定的隊伍 ID:', { team1IdToUpdate, team2IdToUpdate });

        if (team1IdToUpdate && team2IdToUpdate) {
             const { error: updateDetailError } = await supabase
              .from('contest_match_detail')
              .update({ team1_id: team1IdToUpdate, team2_id: team2IdToUpdate })
              .eq('match_detail_id', ch.match_detail_id);

            if (updateDetailError) {
              console.error('DEBUG ChallengeListPage: 更新 contest_match_detail 隊伍 ID 失敗:', updateDetailError);
            } else {
              console.log('DEBUG ChallengeListPage: 成功更新 contest_match_detail 的隊伍 ID');
            }
        } else {
             console.warn('DEBUG ChallengeListPage: 無法確定隊伍 ID，跳過更新 contest_match_detail');
        }
      }

      await fetchAll();
    }
    
    // 更新本地計數
    const updateLocalCount = () => {
      const pendingCount = receivedChallenges.filter((ch: ChallengeDetail) => {
        let playerField = '';
        if (user.name === ch.player1) playerField = 'player1_status';
        else if (user.name === ch.player2) playerField = 'player2_status';
        else if (user.name === ch.player3) playerField = 'player3_status';
        else if (user.name === ch.player4) playerField = 'player4_status';
        else return false;
        const status = ch.status_log?.[playerField];
        return !status || status === '未讀取';
      }).length;
      localStorage.setItem('pendingChallengeCount', String(pendingCount));
      window.dispatchEvent(new Event('storage'));
      const updateEvent = new Event('updateNotificationCount');
      window.dispatchEvent(updateEvent);
    };
    updateLocalCount();
    setActionLoading(null);
  };

  // 更新未讀計數（保持不變）
  React.useEffect(() => {
    if (!user) return;
    const updateUnreadCount = () => {
      const count = receivedChallenges.filter((ch: ChallengeDetail) => {
        let playerField = '';
        if (user.name === ch.player1) playerField = 'player1_status';
        else if (user.name === ch.player2) playerField = 'player2_status';
        else if (user.name === ch.player3) playerField = 'player3_status';
        else if (user.name === ch.player4) playerField = 'player4_status';
        else return false;
        const status = ch.status_log?.[playerField];
        return !status || status === '未讀取';
      }).length;
      localStorage.setItem('pendingChallengeCount', String(count));
      window.dispatchEvent(new Event('storage'));
    };
    updateUnreadCount();
  }, [receivedChallenges, user]);

  // 計算未回覆數量（保持不變）
  const NotrRsponse = React.useMemo(() => {
    if (!user) return 0;
    return receivedChallenges.filter((ch: ChallengeDetail) => {
      let playerField = '';
      if (user.name === ch.player1) playerField = 'player1_status';
      else if (user.name === ch.player2) playerField = 'player2_status';
      else if (user.name === ch.player3) playerField = 'player3_status';
      else if (user.name === ch.player4) playerField = 'player4_status';
      else return false;
      const status = ch.status_log?.[playerField];
      return !status || status === '未讀取';
    }).length;
  }, [receivedChallenges, user]);

  // 分組（保持不變）
  const expiredChallenges = receivedChallenges.filter(isExpired);
  const activeChallenges = receivedChallenges.filter((ch: ChallengeDetail) => !isExpired(ch));
  const expiredInitiated = initiatedChallenges.filter(isExpired);
  const activeInitiated = initiatedChallenges.filter((ch: ChallengeDetail) => !isExpired(ch));

  return (
    <div style={{ maxWidth: 1100, margin: '32px auto', padding: 24, background: '#fff', borderRadius: 18, boxShadow: '0 2px 16px rgba(0,0,0,0.08)', minHeight: 600 }}>
      <h2 style={{ fontSize: 26, fontWeight: 800, marginBottom: 8, letterSpacing: 2, color: '#222' }}>挑戰詳細列表</h2>
      <div style={{ fontSize: 14, color: '#555', marginBottom: 8 }}>
        登入者：{user?.name}{user?.email ? `（${user.email}）` : ''}
      </div>
      {/* 修正：顯示當前用戶的團隊資訊 */}
      <div style={{ fontSize: 14, color: '#555', marginBottom: 20 }}>
        團隊ID：{user?.team_id}
      </div>
      
      {loading ? (
        <div style={{ fontSize: 18, padding: 32, textAlign: 'center', color: '#888' }}>載入中...</div>
      ) : (
        <>
          {/* 收到的挑戰表格 - 未過期 */}
          {activeChallenges.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontWeight: 600, color: '#1a7f37', marginBottom: 4 }}>
                尚未過期 ({activeChallenges.length}筆)
              </div>
              <div style={{ overflowX: 'auto', borderRadius: 12, boxShadow: '0 1px 4px #eee' }}>
                <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 560, background: '#fafbfc', borderRadius: 12, border: '1px solid #d5dbe0' }}>
                  <thead>
                    <tr style={{ background: '#f2f4f8', color: '#222', fontWeight: 700, fontSize: 15 }}>
                      <th style={{ width: 60, padding: 5, border: '1px solid #d5dbe0' }}>發起人</th>
                      <th style={{ width: 60, padding: 5, border: '1px solid #d5dbe0' }}>成員1</th>
                      <th style={{ width: 60, padding: 5, border: '1px solid #d5dbe0' }}>成員2</th>
                      <th style={{ width: 60, padding: 5, border: '1px solid #d5dbe0' }}>成員3</th>
                      <th style={{ width: 60, padding: 5, border: '1px solid #d5dbe0' }}>成員4</th>
                      <th style={{ width: 70, padding: 5, border: '1px solid #d5dbe0' }}>類型</th>
                      <th style={{ width: 80, padding: 5, border: '1px solid #d5dbe0' }}>比賽日期</th>
                      <th style={{ width: 70, padding: 5, border: '1px solid #d5dbe0' }}>時段</th>
                      <th style={{ width: 100, padding: 5, border: '1px solid #d5dbe0' }}>操作</th>
                      <th style={{ width: 60, textAlign: 'center' }}>前往</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeChallenges.length === 0 ? (
                      <tr>
                        <td colSpan={10} style={{ textAlign: 'center', color: '#aaa', padding: 12 }}>無尚未過期的挑戰</td>
                      </tr>
                    ) : (
                      activeChallenges.map((ch, idx) => (
                        <tr key={ch.challenge_id} style={{ background: idx%2===0?'#fff':'#f7f9fa' }}>
                          <td style={{ width: 60, padding: 4, textAlign: 'center', border: '1px solid #d5dbe0' }}>
                            {ch.initiator}
                          </td>
                          <td style={{ width: 60, padding: 4, textAlign: 'center', border: '1px solid #d5dbe0' }}>
                            {ch.player1 ? (
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <span 
                                  style={{ 
                                    color: ch.status_log?.player1_status === '已接受' ? '#22b573' : 
                                           ch.status_log?.player1_status === '已拒絕' ? '#d7263d' : '#888',
                                    fontWeight: 'bold',
                                    marginRight: 3,
                                    fontSize: 12
                                  }}
                                  title={ch.status_log?.player1_status || '未讀取'}
                                >
                                  {getStatusSymbol_v4(ch.status_log?.player1_status)}
                                </span>
                                <span>{ch.player1}</span>
                              </div>
                            ) : '-'}
                          </td>
                          <td style={{ width: 60, padding: 4, textAlign: 'center', border: '1px solid #d5dbe0' }}>
                            {ch.player2 ? (
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <span 
                                  style={{ 
                                    color: ch.status_log?.player2_status === '已接受' ? '#22b573' : 
                                           ch.status_log?.player2_status === '已拒絕' ? '#d7263d' : '#888',
                                    fontWeight: 'bold',
                                    marginRight: 3,
                                    fontSize: 12
                                  }}
                                  title={ch.status_log?.player2_status || '未讀取'}
                                >
                                  {getStatusSymbol_v4(ch.status_log?.player2_status)}
                                </span>
                                <span>{ch.player2}</span>
                              </div>
                            ) : '-'}
                          </td>
                          <td style={{ width: 60, padding: 4, textAlign: 'center', border: '1px solid #d5dbe0' }}>
                            {ch.player3 ? (
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <span 
                                  style={{ 
                                    color: ch.status_log?.player3_status === '已接受' ? '#22b573' : 
                                           ch.status_log?.player3_status === '已拒絕' ? '#d7263d' : '#888',
                                    fontWeight: 'bold',
                                    marginRight: 3,
                                    fontSize: 12
                                  }}
                                  title={ch.status_log?.player3_status || '未讀取'}
                                >
                                  {getStatusSymbol_v4(ch.status_log?.player3_status)}
                                </span>
                                <span>{ch.player3}</span>
                              </div>
                            ) : '-'}
                          </td>
                          <td style={{ width: 60, padding: 4, textAlign: 'center', border: '1px solid #d5dbe0' }}>
                            {ch.player4 ? (
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <span 
                                  style={{ 
                                    color: ch.status_log?.player4_status === '已接受' ? '#22b573' : 
                                           ch.status_log?.player4_status === '已拒絕' ? '#d7263d' : '#888',
                                    fontWeight: 'bold',
                                    marginRight: 3,
                                    fontSize: 12
                                  }}
                                  title={ch.status_log?.player4_status || '未讀取'}
                                >
                                  {getStatusSymbol_v4(ch.status_log?.player4_status)}
                                </span>
                                <span>{ch.player4}</span>
                              </div>
                            ) : '-'}
                          </td>
                          <td style={{ width: 70, padding: 4, textAlign: 'center', border: '1px solid #d5dbe0' }}>{ch.game_type === 'single' ? '單打' : '雙打'}</td>
                          <td style={{ width: 80, padding: 4, textAlign: 'center', border: '1px solid #d5dbe0' }}>{(ch as any).challenge_date ? new Date((ch as any).challenge_date).toISOString().slice(0,10) : (ch.created_at ? new Date(ch.created_at).toISOString().slice(0,10) : '-')}</td>
                          <td style={{ width: 70, padding: 4, textAlign: 'center', border: '1px solid #d5dbe0' }}>{ch.time_slot}</td>
                          <td style={{ width: 100, padding: 4, textAlign: 'center', border: '1px solid #d5dbe0' }}>
                            {(() => {
                              let playerField = '';
                              if (user.name === ch.player1) playerField = 'player1_status';
                              else if (user.name === ch.player2) playerField = 'player2_status';
                              else if (user.name === ch.player3) playerField = 'player3_status';
                              else if (user.name === ch.player4) playerField = 'player4_status';
                              else return <span style={{ color: '#bbb' }}>-</span>;
                              
                              const status = ch.status_log?.[playerField];
                              const isInitiator = user.name === ch.initiator; // 檢查是否為發起人
                              
                              return (
                                <div style={{ display: 'flex', gap: '4px', justifyContent: 'center', alignItems: 'center' }}>
                                  {/* 接受/拒絕下拉選單 */}
                                  <select
                                    value={status === '已接受' ? '接受' : status === '已拒絕' ? '謝絕' : '考慮中'}
                                    onChange={async (e) => {
                                      const selectedLabel = e.target.value;
                                      let selectedValue = '';
                                      if (selectedLabel === '接受') selectedValue = '已接受';
                                      else if (selectedLabel === '謝絕') selectedValue = '已拒絕';
                                      else selectedValue = '未讀取';
                                      
                                      const confirmMsg = `確定要將狀態改為「${selectedLabel}」嗎？`;
                                      if (!window.confirm(confirmMsg)) return;
                                      await handleAction(ch, selectedValue);
                                    }}
                                    style={{
                                      width: isInitiator ? '65px' : '80px', // 發起人時縮小選單，為刪除按鈕留空間
                                      padding: '2px',
                                      fontSize: '12px',
                                      color: status === '已接受' ? '#22b573' : status === '已拒絕' ? '#d7263d' : '#333',
                                      fontWeight: status === '已接受' || status === '已拒絕' ? 700 : 400,
                                      border: '1px solid #ccc',
                                      borderRadius: '4px',
                                      background: '#fff'
                                    }}
                                  >
                                    <option value="考慮中">考慮中</option>
                                    <option value="接受" style={{ color: '#22b573', fontWeight: 700 }}>接受</option>
                                    <option value="謝絕" style={{ color: '#d7263d', fontWeight: 700 }}>謝絕</option>
                                  </select>
                                  
                                  {/* 只有發起人才能看到刪除按鈕 */}
                                  {isInitiator && (
                                    <button
                                      onClick={() => handleDeleteChallenge(ch)}
                                      disabled={actionLoading === ch.challenge_id}
                                      style={{
                                        padding: '2px 6px',
                                        fontSize: '12px',
                                        background: '#dc3545',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '4px',
                                        cursor: actionLoading === ch.challenge_id ? 'not-allowed' : 'pointer',
                                        opacity: actionLoading === ch.challenge_id ? 0.6 : 1
                                      }}
                                      title="刪除此挑戰（僅發起人可操作）"
                                    >
                                      {actionLoading === ch.challenge_id ? '...' : '🗑️'}
                                    </button>
                                  )}
                                </div>
                              );
                            })()}
                          </td>
                          <td style={{ width: 60, textAlign: 'center' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                              <button
                                style={{ background: '#f5f5f5', border: '1px solid #ccc', borderRadius: 16, padding: '4px 10px', cursor: 'pointer' }}
                                title={ch.game_type === 'single' ? '前往單打頁面' : '前往雙打頁面'}
                                onClick={() => {
                                  const getIdByName = (name: string) => {
                                    if (playerIdMap[name] && playerIdMap[name].shortId) {
                                      return playerIdMap[name].shortId || '';
                                    }
                                    return members.find((m) => m.name === name)?.id || '';
                                  };
                                  const params = new URLSearchParams();
                                  if (ch.game_type === 'single') {
                                    if (ch.player1) {
                                      const id = getIdByName(ch.player1);
                                      if (id) params.append('player1', id);
                                    }
                                    if (ch.player2) {
                                      const id = getIdByName(ch.player2);
                                      if (id) params.append('player2', id);
                                    }
                                    if (ch.player3) {
                                      const id = getIdByName(ch.player3);
                                      if (id) params.append('player3', id);
                                    }
                                    if (ch.player4) {
                                      const id = getIdByName(ch.player4);
                                      if (id) params.append('player4', id);
                                    }
                                    
                                    if (ch.match_detail_id) {
                                      params.append('match_detail_id', ch.match_detail_id.toString());
                                      if (matchDetailToContestMap && matchDetailToContestMap[ch.match_detail_id]) {
                                        params.append('contest_id', matchDetailToContestMap[ch.match_detail_id].toString());
                                      }
                                      if (contestNames && contestNames[ch.match_detail_id]) {
                                        params.append('contest_name', contestNames[ch.match_detail_id]);
                                      }
                                      params.append('from_battleroom', 'true');
                                    }
                                    
                                    navigate(`/single?${params.toString()}`);
                                  } else {
                                    if (ch.player1) {
                                      const id = getIdByName(ch.player1);
                                      if (id) params.append('player1', id);
                                    }
                                    if (ch.player2) {
                                      const id = getIdByName(ch.player2);
                                      if (id) params.append('player2', id);
                                    }
                                    if (ch.player3) {
                                      const id = getIdByName(ch.player3);
                                      if (id) params.append('player3', id);
                                    }
                                    if (ch.player4) {
                                      const id = getIdByName(ch.player4);
                                      if (id) params.append('player4', id);
                                    }
                                    
                                    if (ch.match_detail_id) {
                                      params.append('match_detail_id', ch.match_detail_id.toString());
                                      if (matchDetailToContestMap && matchDetailToContestMap[ch.match_detail_id]) {
                                        params.append('contest_id', matchDetailToContestMap[ch.match_detail_id].toString());
                                      }
                                      if (contestNames && contestNames[ch.match_detail_id]) {
                                        params.append('contest_name', contestNames[ch.match_detail_id]);
                                      }
                                      if (teamInfoMap && teamInfoMap[ch.match_detail_id]) {
                                        const teamInfo = teamInfoMap[ch.match_detail_id];
                                        if (teamInfo.team1_id) {
                                          params.append('team1_id', teamInfo.team1_id.toString());
                                        }
                                        if (teamInfo.team2_id) {
                                          params.append('team2_id', teamInfo.team2_id.toString());
                                        }
                                        if (teamInfo.team1_name) {
                                          params.append('team1_name', teamInfo.team1_name);
                                        }
                                        if (teamInfo.team2_name) {
                                          params.append('team2_name', teamInfo.team2_name);
                                        }
                                        if (teamInfo.team1_members && teamInfo.team1_members.length > 0) {
                                          params.append('team1_members', JSON.stringify(teamInfo.team1_members));
                                        }
                                        if (teamInfo.team2_members && teamInfo.team2_members.length > 0) {
                                          params.append('team2_members', JSON.stringify(teamInfo.team2_members));
                                        }
                                      }
                                      params.append('from_battleroom', 'true');
                                    }
                                    
                                    navigate(`/double_game?${params.toString()}`);
                                  }
                                }}
                              >
                                <span style={{ fontWeight: 700, fontSize: 16 }}>→</span>
                              </button>
                              {ch.match_detail_id && contestNames && contestNames[ch.match_detail_id] && (
                                <span style={{ 
                                  color: 'red', 
                                  fontWeight: 'bold', 
                                  fontSize: 12,
                                  maxWidth: '80px',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                  marginTop: 2
                                }} title={contestNames[ch.match_detail_id]}>
                                  {contestNames[ch.match_detail_id]}
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 收到的挑戰表格 - 已過期 */}
          {expiredChallenges.length > 0 && (
            <div style={{ marginBottom: 48 }}>
              <div style={{ fontWeight: 600, color: '#d7263d', marginBottom: 4 }}>
                已過期 ({expiredChallenges.length}筆)
              </div>
              <div style={{ overflowX: 'auto', borderRadius: 12, boxShadow: '0 1px 4px #eee' }}>
                <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 560, background: '#fafbfc', borderRadius: 12, border: '1px solid #d5dbe0' }}>
                  <thead>
                    <tr style={{ background: '#f2f4f8', color: '#222', fontWeight: 700, fontSize: 15 }}>
                      <th style={{ width: 60, padding: 5, border: '1px solid #d5dbe0' }}>發起人</th>
                      <th style={{ width: 60, padding: 5, border: '1px solid #d5dbe0' }}>成員1</th>
                      <th style={{ width: 60, padding: 5, border: '1px solid #d5dbe0' }}>成員2</th>
                      <th style={{ width: 60, padding: 5, border: '1px solid #d5dbe0' }}>成員3</th>
                      <th style={{ width: 60, padding: 5, border: '1px solid #d5dbe0' }}>成員4</th>
                      <th style={{ width: 70, padding: 5, border: '1px solid #d5dbe0' }}>類型</th>
                      <th style={{ width: 80, padding: 5, border: '1px solid #d5dbe0' }}>比賽日期</th>
                      <th style={{ width: 70, padding: 5, border: '1px solid #d5dbe0' }}>時段</th>
                      <th style={{ width: 100, padding: 5, border: '1px solid #d5dbe0' }}>操作</th>
                      <th style={{ width: 60, textAlign: 'center' }}>前往</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expiredChallenges.length === 0 ? (
                      <tr>
                        <td colSpan={10} style={{ textAlign: 'center', color: '#aaa', padding: 12 }}>無已過期的挑戰</td>
                      </tr>
                    ) : (
                      expiredChallenges.map((ch, idx) => (
                        <tr key={ch.challenge_id} style={{ background: idx%2===0?'#fff':'#f7f9fa' }}>
                          <td style={{ width: 60, padding: 4, textAlign: 'center', border: '1px solid #d5dbe0' }}>
                            {ch.initiator}
                          </td>
                          <td style={{ width: 60, padding: 4, textAlign: 'center', border: '1px solid #d5dbe0' }}>
                            {ch.player1 ? (
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <span 
                                  style={{ 
                                    color: ch.status_log?.player1_status === '已接受' ? '#22b573' : 
                                           ch.status_log?.player1_status === '已拒絕' ? '#d7263d' : '#888',
                                    fontWeight: 'bold',
                                    marginRight: 3,
                                    fontSize: 12
                                  }}
                                  title={ch.status_log?.player1_status || '未讀取'}
                                >
                                  {getStatusSymbol_v4(ch.status_log?.player1_status)}
                                </span>
                                <span>{ch.player1}</span>
                              </div>
                            ) : '-'}
                          </td>
                          <td style={{ width: 60, padding: 4, textAlign: 'center', border: '1px solid #d5dbe0' }}>
                            {ch.player2 ? (
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <span 
                                  style={{ 
                                    color: ch.status_log?.player2_status === '已接受' ? '#22b573' : 
                                           ch.status_log?.player2_status === '已拒絕' ? '#d7263d' : '#888',
                                    fontWeight: 'bold',
                                    marginRight: 3,
                                    fontSize: 12
                                  }}
                                  title={ch.status_log?.player2_status || '未讀取'}
                                >
                                  {getStatusSymbol_v4(ch.status_log?.player2_status)}
                                </span>
                                <span>{ch.player2}</span>
                              </div>
                            ) : '-'}
                          </td>
                          <td style={{ width: 60, padding: 4, textAlign: 'center', border: '1px solid #d5dbe0' }}>
                            {ch.player3 ? (
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <span 
                                  style={{ 
                                    color: ch.status_log?.player3_status === '已接受' ? '#22b573' : 
                                           ch.status_log?.player3_status === '已拒絕' ? '#d7263d' : '#888',
                                    fontWeight: 'bold',
                                    marginRight: 3,
                                    fontSize: 12
                                  }}
                                  title={ch.status_log?.player3_status || '未讀取'}
                                >
                                  {getStatusSymbol_v4(ch.status_log?.player3_status)}
                                </span>
                                <span>{ch.player3}</span>
                              </div>
                            ) : '-'}
                          </td>
                          <td style={{ width: 60, padding: 4, textAlign: 'center', border: '1px solid #d5dbe0' }}>
                            {ch.player4 ? (
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <span 
                                  style={{ 
                                    color: ch.status_log?.player4_status === '已接受' ? '#22b573' : 
                                           ch.status_log?.player4_status === '已拒絕' ? '#d7263d' : '#888',
                                    fontWeight: 'bold',
                                    marginRight: 3,
                                    fontSize: 12
                                  }}
                                  title={ch.status_log?.player4_status || '未讀取'}
                                >
                                  {getStatusSymbol_v4(ch.status_log?.player4_status)}
                                </span>
                                <span>{ch.player4}</span>
                              </div>
                            ) : '-'}
                          </td>
                          <td style={{ width: 70, padding: 4, textAlign: 'center', border: '1px solid #d5dbe0' }}>{ch.game_type === 'single' ? '單打' : '雙打'}</td>
                          <td style={{ width: 80, padding: 4, textAlign: 'center', border: '1px solid #d5dbe0' }}>{(ch as any).challenge_date ? new Date((ch as any).challenge_date).toISOString().slice(0,10) : (ch.created_at ? new Date(ch.created_at).toISOString().slice(0,10) : '-')}</td>
                          <td style={{ width: 70, padding: 4, textAlign: 'center', border: '1px solid #d5dbe0' }}>{ch.time_slot}</td>
                          <td style={{ width: 100, padding: 4, textAlign: 'center', border: '1px solid #d5dbe0' }}>
                            <div style={{ display: 'flex', gap: '4px', justifyContent: 'center', alignItems: 'center' }}>
                              {(() => {
                                let playerField = '';
                                if (user.name === ch.player1) playerField = 'player1_status';
                                else if (user.name === ch.player2) playerField = 'player2_status';
                                else if (user.name === ch.player3) playerField = 'player3_status';
                                else if (user.name === ch.player4) playerField = 'player4_status';
                                else return <span style={{ color: '#bbb' }}>-</span>;
                                
                                const status = ch.status_log?.[playerField];
                                const isInitiator = user.name === ch.initiator; // 檢查是否為發起人
                                
                                if (status === '已接受') return renderStatus(status);
                                if (status === '已拒絕') return renderStatus(status);
                                return <span style={{ color: '#999' }}>已過期</span>;
                              })()}
                              
                              {/* 只有發起人才能刪除過期挑戰 */}
                              {user.name === ch.initiator && (
                                <button
                                  onClick={() => handleDeleteChallenge(ch)}
                                  disabled={actionLoading === ch.challenge_id}
                                  style={{
                                    padding: '2px 6px',
                                    fontSize: '12px',
                                    background: '#dc3545',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: actionLoading === ch.challenge_id ? 'not-allowed' : 'pointer',
                                    opacity: actionLoading === ch.challenge_id ? 0.6 : 1
                                  }}
                                  title="刪除此挑戰（僅發起人可操作）"
                                >
                                  {actionLoading === ch.challenge_id ? '...' : '🗑️'}
                                </button>
                              )}
                            </div>
                          </td>
                          <td style={{ width: 60, textAlign: 'center' }}>
                            <button
                              style={{ background: '#f5f5f5', border: '1px solid #ccc', borderRadius: 16, padding: '4px 10px', cursor: 'pointer' }}
                              title={ch.game_type === 'single' ? '前往單打頁面' : '前往雙打頁面'}
                              onClick={() => {
                                const getIdByName = (name: string) => members.find((m) => m.name === name)?.id || '';
                                const params = new URLSearchParams();
                                if (ch.game_type === 'single') {
                                  if (ch.player1) {
                                    const id = getIdByName(ch.player1);
                                    if (id) params.append('player1', id);
                                  }
                                  if (ch.player2) {
                                    const id = getIdByName(ch.player2);
                                    if (id) params.append('player2', id);
                                  }
                                  if (ch.player3) {
                                    const id = getIdByName(ch.player3);
                                    if (id) params.append('player3', id);
                                  }
                                  if (ch.player4) {
                                    const id = getIdByName(ch.player4);
                                    if (id) params.append('player4', id);
                                  }
                                  
                                  if (ch.match_detail_id) {
                                    params.append('match_detail_id', ch.match_detail_id.toString());
                                    if (matchDetailToContestMap && matchDetailToContestMap[ch.match_detail_id]) {
                                      params.append('contest_id', matchDetailToContestMap[ch.match_detail_id].toString());
                                    }
                                    if (contestNames && contestNames[ch.match_detail_id]) {
                                      params.append('contest_name', contestNames[ch.match_detail_id]);
                                    }
                                    params.append('from_battleroom', 'true');
                                  }
                                  
                                  navigate(`/single?${params.toString()}`);
                                } else {
                                  if (ch.player1) {
                                    const id = getIdByName(ch.player1);
                                    if (id) params.append('player1', id);
                                  }
                                  if (ch.player2) {
                                    const id = getIdByName(ch.player2);
                                    if (id) params.append('player2', id);
                                  }
                                  if (ch.player3) {
                                    const id = getIdByName(ch.player3);
                                    if (id) params.append('player3', id);
                                  }
                                  if (ch.player4) {
                                    const id = getIdByName(ch.player4);
                                    if (id) params.append('player4', id);
                                  }
                                  
                                  if (ch.match_detail_id) {
                                    params.append('match_detail_id', ch.match_detail_id.toString());
                                    if (matchDetailToContestMap && matchDetailToContestMap[ch.match_detail_id]) {
                                      params.append('contest_id', matchDetailToContestMap[ch.match_detail_id].toString());
                                    }
                                    if (contestNames && contestNames[ch.match_detail_id]) {
                                      params.append('contest_name', contestNames[ch.match_detail_id]);
                                    }
                                    params.append('from_battleroom', 'true');
                                  }
                                  
                                  navigate(`/double_game?${params.toString()}`);
                                }
                              }}
                            >
                              <span style={{ fontWeight: 700, fontSize: 16 }}>→</span>
                            </button>
                            {ch.match_detail_id && (
                              <span style={{ color: 'red', fontWeight: 'bold', marginLeft: 4, fontSize: 16 }}>R</span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          
          {/* 我發起的挑戰區塊 */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontWeight: 600, color: '#1a7f37', marginBottom: 4 }}>我發起的挑戰</div>
            {/* 尚未過期的挑戰 */}
            {activeInitiated.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontWeight: 500, color: '#1a7f37', marginBottom: 4 }}>
                  尚未過期 ({activeInitiated.length}筆)
                </div>
                <div style={{ overflowX: 'auto', borderRadius: 12, boxShadow: '0 1px 4px #eee', maxHeight: 370, overflowY: activeInitiated.length > 10 ? 'auto' : 'visible' }}>
                  <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 560, background: '#fafbfc', borderRadius: 12, border: '1px solid #d5dbe0' }}>
                    <thead>
                      <tr style={{ background: '#f2f4f8', color: '#222', fontWeight: 700, fontSize: 15 }}>
                        <th style={{ width: 60, padding: 5, border: '1px solid #d5dbe0' }}>發起人</th>
                        <th style={{ width: 60, padding: 5, border: '1px solid #d5dbe0' }}>成員1</th>
                        <th style={{ width: 60, padding: 5, border: '1px solid #d5dbe0' }}>成員2</th>
                        <th style={{ width: 60, padding: 5, border: '1px solid #d5dbe0' }}>成員3</th>
                        <th style={{ width: 60, padding: 5, border: '1px solid #d5dbe0' }}>成員4</th>
                        <th style={{ width: 70, padding: 5, border: '1px solid #d5dbe0' }}>類型</th>
                        <th style={{ width: 80, padding: 5, border: '1px solid #d5dbe0' }}>比賽日期</th>
                        <th style={{ width: 70, padding: 5, border: '1px solid #d5dbe0' }}>時段</th>
                        <th style={{ width: 80, padding: 5, border: '1px solid #d5dbe0' }}>操作</th>
                        <th style={{ width: 60, textAlign: 'center' }}>前往</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeInitiated.length === 0 ? (
                        <tr>
                          <td colSpan={10} style={{ textAlign: 'center', color: '#aaa', padding: 12 }}>無尚未過期的發起挑戰</td>
                        </tr>
                      ) : (
                        activeInitiated.map((ch, idx) => (
                          <tr key={ch.challenge_id} style={{ background: idx%2===0?'#fff':'#f7f9fa' }}>
                            <td style={{ width: 60, padding: 4, textAlign: 'center', border: '1px solid #d5dbe0' }}>{ch.initiator}</td>
                            <td style={{ width: 60, padding: 4, textAlign: 'center', border: '1px solid #d5dbe0' }}>{ch.player1 || '-'}</td>
                            <td style={{ width: 60, padding: 4, textAlign: 'center', border: '1px solid #d5dbe0' }}>{ch.player2 || '-'}</td>
                            <td style={{ width: 60, padding: 4, textAlign: 'center', border: '1px solid #d5dbe0' }}>{ch.player3 || '-'}</td>
                            <td style={{ width: 60, padding: 4, textAlign: 'center', border: '1px solid #d5dbe0' }}>{ch.player4 || '-'}</td>
                            <td style={{ width: 70, padding: 4, textAlign: 'center', border: '1px solid #d5dbe0' }}>{ch.game_type === 'single' ? '單打' : '雙打'}</td>
                            <td style={{ width: 80, padding: 4, textAlign: 'center', border: '1px solid #d5dbe0' }}>{ch.challenge_date ? ch.challenge_date.split('T')[0] : (ch.created_at ? ch.created_at.split('T')[0] : '')}</td>
                            <td style={{ width: 70, padding: 4, textAlign: 'center', border: '1px solid #d5dbe0' }}>{ch.time_slot}</td>
                            <td style={{ width: 80, padding: 4, textAlign: 'center', border: '1px solid #d5dbe0' }}>
                              {/* 只有發起人才能刪除自己發起的挑戰 */}
                              {user.name === ch.initiator ? (
                                <button
                                  onClick={() => handleDeleteChallenge(ch)}
                                  disabled={actionLoading === ch.challenge_id}
                                  style={{
                                    padding: '4px 8px',
                                    fontSize: '12px',
                                    background: '#dc3545',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: actionLoading === ch.challenge_id ? 'not-allowed' : 'pointer',
                                    opacity: actionLoading === ch.challenge_id ? 0.6 : 1
                                  }}
                                  title="刪除此挑戰（僅發起人可操作）"
                                >
                                  {actionLoading === ch.challenge_id ? '刪除中...' : '🗑️ 刪除'}
                                </button>
                              ) : (
                                <span style={{ color: '#bbb' }}>無權限</span>
                              )}
                            </td>
                            <td style={{ width: 60, textAlign: 'center' }}>-</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            
            {/* 已過期的挑戰 */}
            {expiredInitiated.length > 0 && (
              <div>
                <div style={{ fontWeight: 500, color: '#888', marginBottom: 4 }}>
                  已過期 ({expiredInitiated.length}筆)
                </div>
                <div style={{ overflowX: 'auto', borderRadius: 12, boxShadow: '0 1px 4px #eee', maxHeight: 150, overflowY: expiredInitiated.length > 3 ? 'auto' : 'visible' }}>
                  <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 560, background: '#fafbfc', borderRadius: 12, border: '1px solid #d5dbe0' }}>
                    <thead>
                      <tr style={{ background: '#f2f4f8', color: '#222', fontWeight: 700, fontSize: 15 }}>
                        <th style={{ width: 60, padding: 5, border: '1px solid #d5dbe0' }}>發起人</th>
                        <th style={{ width: 60, padding: 5, border: '1px solid #d5dbe0' }}>成員1</th>
                        <th style={{ width: 60, padding: 5, border: '1px solid #d5dbe0' }}>成員2</th>
                        <th style={{ width: 60, padding: 5, border: '1px solid #d5dbe0' }}>成員3</th>
                        <th style={{ width: 60, padding: 5, border: '1px solid #d5dbe0' }}>成員4</th>
                        <th style={{ width: 70, padding: 5, border: '1px solid #d5dbe0' }}>類型</th>
                        <th style={{ width: 80, padding: 5, border: '1px solid #d5dbe0' }}>比賽日期</th>
                        <th style={{ width: 70, padding: 5, border: '1px solid #d5dbe0' }}>時段</th>
                        <th style={{ width: 80, padding: 5, border: '1px solid #d5dbe0' }}>操作</th>
                        <th style={{ width: 60, textAlign: 'center' }}>前往</th>
                      </tr>
                    </thead>
                    <tbody>
                      {expiredInitiated.length === 0 ? (
                        <tr>
                          <td colSpan={10} style={{ textAlign: 'center', color: '#aaa', padding: 12 }}>無已過期的發起挑戰</td>
                        </tr>
                      ) : (
                        expiredInitiated.slice(0, 3).map((ch, idx) => (
                          <tr key={ch.challenge_id} style={{ background: idx%2===0?'#fff':'#f7f9fa' }}>
                            <td style={{ width: 60, padding: 4, textAlign: 'center', border: '1px solid #d5dbe0' }}>{ch.initiator}</td>
                            <td style={{ width: 60, padding: 4, textAlign: 'center', border: '1px solid #d5dbe0' }}>{ch.player1 || '-'}</td>
                            <td style={{ width: 60, padding: 4, textAlign: 'center', border: '1px solid #d5dbe0' }}>{ch.player2 || '-'}</td>
                            <td style={{ width: 60, padding: 4, textAlign: 'center', border: '1px solid #d5dbe0' }}>{ch.player3 || '-'}</td>
                            <td style={{ width: 60, padding: 4, textAlign: 'center', border: '1px solid #d5dbe0' }}>{ch.player4 || '-'}</td>
                            <td style={{ width: 70, padding: 4, textAlign: 'center', border: '1px solid #d5dbe0' }}>{ch.game_type === 'single' ? '單打' : '雙打'}</td>
                            <td style={{ width: 80, padding: 4, textAlign: 'center', border: '1px solid #d5dbe0' }}>{ch.challenge_date ? ch.challenge_date.split('T')[0] : (ch.created_at ? ch.created_at.split('T')[0] : '')}</td>
                            <td style={{ width: 70, padding: 4, textAlign: 'center', border: '1px solid #d5dbe0' }}>{ch.time_slot}</td>
                            <td style={{ width: 80, padding: 4, textAlign: 'center', border: '1px solid #d5dbe0' }}>
                              {/* 只有發起人才能刪除過期的發起挑戰 */}
                              {user.name === ch.initiator ? (
                                <button
                                  onClick={() => handleDeleteChallenge(ch)}
                                  disabled={actionLoading === ch.challenge_id}
                                  style={{
                                    padding: '2px 6px',
                                    fontSize: '12px',
                                    background: '#dc3545',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: actionLoading === ch.challenge_id ? 'not-allowed' : 'pointer',
                                    opacity: actionLoading === ch.challenge_id ? 0.6 : 1
                                  }}
                                  title="刪除此挑戰（僅發起人可操作）"
                                >
                                  {actionLoading === ch.challenge_id ? '...' : '🗑️'}
                                </button>
                              ) : (
                                <span style={{ color: '#bbb' }}>無權限</span>
                              )}
                            </td>
                            <td style={{ width: 60, textAlign: 'center' }}>-</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
          
          {/* 顯示過濾統計 */}
          <div style={{ marginTop: 24, padding: 16, background: '#f8f9fa', borderRadius: 8, border: '1px solid #e9ecef' }}>
            <h4 style={{ margin: '0 0 8px 0', color: '#495057' }}>過濾統計</h4>
            <div style={{ fontSize: 14, color: '#6c757d' }}>
              • 收到的挑戰：{receivedChallenges.length}筆 (未過期: {activeChallenges.length}, 已過期: {expiredChallenges.length})
            </div>
            <div style={{ fontSize: 14, color: '#6c757d' }}>
              • 發起的挑戰：{initiatedChallenges.length}筆 (未過期: {activeInitiated.length}, 已過期: {expiredInitiated.length})
            </div>
            <div style={{ fontSize: 14, color: '#6c757d' }}>
              • 待回覆：{NotrRsponse}筆
            </div>
            <div style={{ fontSize: 12, color: '#868e96', marginTop: 8 }}>
              ※ 已套用team_id過濾，只顯示團隊內的挑戰
            </div>
          </div>
        </>
      )}
    </div>
  );
}
