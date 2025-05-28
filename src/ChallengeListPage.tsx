import React from 'react';
import { supabase } from './supabaseClient';
import { UserContext } from './UserContext';
import StatusSwitch from './utils/StatusSwitch';
import { useNavigate } from 'react-router-dom'; // 匯入 useNavigate

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
  challenge_date?: string; // 新增 challenge_date 欄位
  match_detail_id?: number; // 新增 match_detail_id 欄位，用於標識來自 contest 的挑戰
}

export default function ChallengeListPage() {
  const { user } = React.useContext(UserContext) ?? { user: null };
  const [receivedChallenges, setReceivedChallenges] = React.useState<ChallengeDetail[]>([]);
  const [initiatedChallenges, setInitiatedChallenges] = React.useState<ChallengeDetail[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [actionLoading, setActionLoading] = React.useState<number|null>(null);
  const navigate = useNavigate(); // 初始化 navigate
  // 新增：取得會員列表（含id與name）
  const [members, setMembers] = React.useState<{ id: string; name: string; team_id: string }[]>([]);
  // 新增：儲存比賽名稱映射 (match_detail_id -> contest_name)
  const [contestNames, setContestNames] = React.useState<Record<number, string>>({});
  const [matchDetailToContestMap, setMatchDetailToContestMap] = React.useState<Record<number, number>>({});
  // 新增：儲存隊伍資訊映射 (match_detail_id -> team info)
  const [teamInfoMap, setTeamInfoMap] = React.useState<Record<number, {
    team1_id?: number;
    team2_id?: number;
    team1_name?: string;
    team2_name?: string;
    team1_members?: string[];
    team2_members?: string[];
  }>>({});
  // 新增：保存玩家ID格式映射
  const [playerIdMap, setPlayerIdMap] = React.useState<Record<string, {
    shortId?: string;
    name?: string;
  }>>({});

  React.useEffect(() => {
    async function fetchMembers() {
      if (!user?.team_id) return;
      const { data, error } = await supabase.from('members').select('id, name, team_id').eq('team_id', user.team_id);
      if (!error && data) setMembers(data);
    }
    fetchMembers();
  }, [user?.team_id]);

  // 新增：從 URL 獲取參數功能
  React.useEffect(() => {
    async function fetchPlayerIdMapping() {
      if (!user?.team_id) return;
      try {
        // 獲取所有相關成員的短ID格式（只限於當前用戶的團隊）
        const { data, error } = await supabase
          .from('members')
          .select('id, name, member_id, team_id')
          .eq('team_id', user.team_id)  // 添加團隊限制，只查詢當前用戶團隊
          .order('name', { ascending: true });

        if (error) {
          console.error('獲取成員ID映射錯誤:', error);
          return;
        }

        if (data && data.length > 0) {
          // 建立玩家名稱到ID映射的字典
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
  
  // 新增：從 URL 獲取參數功能
  React.useEffect(() => {
    async function fetchContestNames() {
      if (!user) return;
      console.log('開始查詢比賽資料...');
      
      // 1. 直接從 challenge_status_logs 表查詢所有非空的 match_detail_id
      const { data: statusLogs, error: logsError } = await supabase
        .from('challenge_status_logs')
        .select('match_detail_id')
        .not('match_detail_id', 'is', null);
      
      console.log('從 challenge_status_logs 表查詢到的資料:', statusLogs);
      console.log('查詢錯誤:', logsError);
      
      if (!statusLogs || statusLogs.length === 0) {
        console.log('沒有找到任何帶有 match_detail_id 的記錄');
        return;
      }
      
      // 2. 提取所有不為空的 match_detail_id
      // 確保將字符串類型的 ID 轉換為數字
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
      
      // 3. 使用 match_detail_id 查詢 contest_match_detail 表獲取 match_id 和 contest_id
      console.log('開始查詢 contest_match_detail 表...');
      const { data: matchDetails, error: matchDetailError } = await supabase
        .from('contest_match_detail')
        .select('match_detail_id, match_id, contest_id')
        .in('match_detail_id', matchDetailIds);
      
      console.log('從 contest_match_detail 表查詢到的資料:', matchDetails);
      console.log('查詢錯誤:', matchDetailError);
      
      if (!matchDetails || matchDetails.length === 0) {
        console.log('沒有在 contest_match_detail 表中找到記錄');
        return;
      }
      
      // 4. 從 contest_match 表中獲取隊伍ID
      const matchIds = matchDetails.map((detail: any) => detail.match_id).filter(Boolean);
      
      const { data: matchData, error: matchError } = await supabase
        .from('contest_match')
        .select('match_id, team1_id, team2_id')
        .in('match_id', matchIds);
      
      if (matchError || !matchData) {
        console.error('查詢 contest_match 表錯誤:', matchError);
        return;
      }
      
      // 5. 獲取隊伍名稱
      const teamIds = matchData.flatMap((match: any) => [match.team1_id, match.team2_id]).filter(Boolean);
      
      const { data: teamData, error: teamError } = await supabase
        .from('contest_team')
        .select('contest_team_id, team_name')
        .in('contest_team_id', teamIds);
      
      if (teamError || !teamData) {
        console.error('查詢隊伍資料錯誤:', teamError);
        return;
      }
      
      // 6. 建立 match_detail_id 到數據的映射
      const mdToContestIdMap: Record<number, number> = {};
      const nameMap: Record<number, string> = {};
      const idMap: Record<number, number> = {};
      const teamInfo: Record<number, any> = {};
      
      // 建立 match_id 到 team 信息的映射
      const matchToTeamsMap: Record<number, {team1_id?: number, team2_id?: number}> = {};
      matchData.forEach((match: any) => {
        matchToTeamsMap[match.match_id] = {
          team1_id: match.team1_id,
          team2_id: match.team2_id
        };
      });
      
      // 建立 team_id 到 team_name 的映射
      const teamIdToNameMap: Record<number, string> = {};
      teamData.forEach((team: any) => {
        teamIdToNameMap[team.contest_team_id] = team.team_name;
      });
      
      // 為每個 match_detail_id 整合所有相關信息
      matchDetails.forEach((detail: any) => {
        const mdId = detail.match_detail_id;
        const matchId = detail.match_id;
        const contestId = detail.contest_id;
        
        if (mdId && contestId) {
          mdToContestIdMap[mdId] = contestId;
          
          // 添加隊伍信息
          if (matchToTeamsMap[matchId]) {
            const team1Id = matchToTeamsMap[matchId].team1_id;
            const team2Id = matchToTeamsMap[matchId].team2_id;
            
            teamInfo[mdId] = {
              team1_id: team1Id,
              team2_id: team2Id,
              team1_name: team1Id ? teamIdToNameMap[team1Id] : undefined,
              team2_name: team2Id ? teamIdToNameMap[team2Id] : undefined,
              team1_members: [], // 先初始化为空数组
              team2_members: []  // 先初始化为空数组
            };
          }
        }
      });
      
      // 获取所有挑战，提取成员信息
      const allChallenges = [...receivedChallenges, ...initiatedChallenges];
      allChallenges.forEach(ch => {
        if (ch.match_detail_id && teamInfo[ch.match_detail_id]) {
          // 将成员名称添加到对应队伍的数组中
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
      
      // 為每個 match_detail_id 尋找對應的 contest_name
      const { data: contests, error: contestsError } = await supabase
        .from('contest')
        .select('contest_id, contest_name')
        .in('contest_id', Object.values(mdToContestIdMap));
      
      if (contestsError) {
        console.error('查詢比賽錯誤:', contestsError);
        return;
      }

      // 為每個 match_detail_id 尋找對應的 contest_name
      for (const mdId of matchDetailIds) {
        const contestId = mdToContestIdMap[mdId];
        if (contestId) {
          const contest = contests.find((c: any) => c.contest_id === contestId);
          if (contest) {
            nameMap[mdId] = contest.contest_name;
            idMap[mdId] = contestId;
            console.log(`建立映射: match_detail_id ${mdId} -> contest_id ${contestId} -> name ${contest.contest_name}`);
          }
        }
      }
      
      console.log('最終的名稱映射:', nameMap);
      console.log('最終的 ID 映射:', idMap);
      console.log('隊伍信息映射:', teamInfo);
      
      setContestNames(nameMap);
      setMatchDetailToContestMap(idMap);
      setTeamInfoMap(teamInfo);
    }
    
    fetchContestNames();
  }, [user]);

  // 1. 將 fetchAll 提升到組件頂層，並用 useCallback 包裹
  const fetchAll = React.useCallback(async () => {
    setLoading(true);
    // 收到的挑戰
    const { data: receivedData } = await supabase
      .from('challenges')
      .select('*, status_code')
      .or(`player1.eq.${user.name},player2.eq.${user.name},player3.eq.${user.name},player4.eq.${user.name}`)
      .order('created_at', { ascending: false });
    // 發起的挑戰
    const { data: initiatedData } = await supabase
      .from('challenges')
      .select('*, status_code')
      .eq('initiator', user.name)
      .order('created_at', { ascending: false });
    // 整合 status_log
    const allChallenges = [...(receivedData || []), ...(initiatedData || [])];
    const statusCodes = allChallenges.map(ch => ch.status_code).filter(Boolean);
    let logsMap: Record<string, any> = {};
    if (statusCodes.length > 0) {
      const { data: logs } = await supabase
        .from('challenge_status_logs')
        .select('*')
        .in('status_code', statusCodes);
      if (logs) {
        logsMap = logs.reduce((acc, log) => {
          acc[log.status_code] = log;
          return acc;
        }, {} as Record<string, any>);
      }
    }
    // 自動更新發起人對應欄位為「已接受」
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
          if (logRow && logRow[status] !== '已接受') {
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
    // 合併 status_log
    setReceivedChallenges((receivedData || []).map((ch: ChallengeDetail) => ({ ...ch, status_log: logsMap[ch.status_code || ''] || {} })));
    setInitiatedChallenges((initiatedData || []).map((ch: ChallengeDetail) => ({ ...ch, status_log: logsMap[ch.status_code || ''] || {} })));
    setLoading(false);
  }, [user]);

  React.useEffect(() => {
    if (!user) return;
    fetchAll();
  }, [user, fetchAll]);

  // 工具函數：判斷挑戰是否過期（比賽日期在今天之前）
  function isExpired(challenge: ChallengeDetail) {
    // 優先用 challenge_date，沒有就用 created_at
    const dateStr = (challenge as any).challenge_date || challenge.created_at;
    if (!dateStr) return false;
    const challengeDate = new Date(dateStr.split('T')[0]);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return challengeDate < today;
  }

  // 在 renderStatus 函數之前添加新的函數
  function getStatusSymbol_v4(status?: string) {
    if (status === '已接受') return '✅'; // 綠色勾勾
    if (status === '已拒絕') return '❌'; // 紅色叉叉
    return '⏳'; // 沙漏
  }

  // 狀態 badge 樣式
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

  // 美化按鈕
  function StyledButton({ children, color, ...props }: { children: React.ReactNode, color: 'green'|'red', [key:string]: any }) {
    const base = {
      border: 'none',
      borderRadius: 8,
      padding: '4px 16px',
      fontWeight: 600,
      fontSize: 14,
      cursor: 'pointer',
      boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
      marginRight: 8,
      transition: 'background 0.2s, color 0.2s',
    } as React.CSSProperties;
    const colorStyle = color === 'green'
      ? { background: '#22b573', color: '#fff' }
      : { background: '#d7263d', color: '#fff' };
    const hover = color === 'green'
      ? { background: '#189c4a' }
      : { background: '#ad1c2f' };
    const [hovered, setHovered] = React.useState(false);
    return (
      <button
        style={{ ...base, ...colorStyle, ...(hovered ? hover : {}) }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        {...props}
      >{children}</button>
    );
  }

  // 接受/拒絕挑戰
  const handleAction = async (ch: ChallengeDetail, action: string) => {
    setActionLoading(ch.challenge_id);
    let playerField = '';
    if (user.name === ch.player1) playerField = 'player1_status';
    else if (user.name === ch.player2) playerField = 'player2_status';
    else if (user.name === ch.player3) playerField = 'player3_status';
    else if (user.name === ch.player4) playerField = 'player4_status';
    else return;
    // 1. 立即前端同步更新（Optimistic UI）
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
    // 2. 資料庫更新
    const { data: logRow } = await supabase
      .from('challenge_status_logs')
      .select('log_id')
      .eq('status_code', ch.status_code) // 改用 status_code 查找
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

      // 新增邏輯：如果接受挑戰且有 match_detail_id，更新 contest_match_detail 的隊伍 ID
      if (action === '已接受' && ch.match_detail_id) {
        console.log('DEBUG ChallengeListPage: 接受挑戰，開始更新 contest_match_detail 的隊伍 ID');
        
        // 根據挑戰類型和玩家找到隊伍 ID
        let team1IdToUpdate: string | null = null;
        let team2IdToUpdate: string | null = null;

        const getMemberTeamId = (playerName: string | undefined) => {
            if (!playerName) return null;
            const member = members.find(m => m.name === playerName);
            return member ? member.team_id : null;
        };

        if (ch.game_type === 'single') {
            // 單打：player1 和 player2 各自代表一個隊伍
            team1IdToUpdate = getMemberTeamId(ch.player1);
            team2IdToUpdate = getMemberTeamId(ch.player2);
        } else if (ch.game_type === 'double') {
            // 雙打：player1/player2 同隊，player3/player4 同隊
            // 假設 player1 和 player3 至少會有一位，以他們的隊伍 ID 為準
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

  // 在組件內部，計算未回覆數量 NotrRsponse
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

  // 在 return 之前，分組
  const expiredChallenges = receivedChallenges.filter(isExpired);
  const activeChallenges = receivedChallenges.filter((ch: ChallengeDetail) => !isExpired(ch));

  // 將 initiatedChallenges 用 isExpired 分成 activeInitiated/expiredInitiated
  const expiredInitiated = initiatedChallenges.filter(isExpired);
  const activeInitiated = initiatedChallenges.filter((ch: ChallengeDetail) => !isExpired(ch));

  return (
    <div style={{ maxWidth: 1100, margin: '32px auto', padding: 24, background: '#fff', borderRadius: 18, boxShadow: '0 2px 16px rgba(0,0,0,0.08)', minHeight: 600 }}>
      <h2 style={{ fontSize: 26, fontWeight: 800, marginBottom: 8, letterSpacing: 2, color: '#222' }}>挑戰詳細列表</h2>
      <div style={{ fontSize: 14, color: '#555', marginBottom: 20 }}>登入者：{user?.name}{user?.email ? `（${user.email}）` : ''}</div>
      {loading ? (
        <div style={{ fontSize: 18, padding: 32, textAlign: 'center', color: '#888' }}>載入中...</div>
      ) : (
        <>
          {/* 挑戰列表的主要內容部分 */}
          {/* 收到的挑戰表格 - 未過期 */}
          {activeChallenges.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontWeight: 600, color: '#1a7f37', marginBottom: 4 }}>尚未過期</div>
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
                      <th style={{ width: 80, padding: 5, border: '1px solid #d5dbe0' }}>操作</th>
                      <th style={{ width: 60, textAlign: 'center' }}>前往</th> {/* 加入「前往」欄位 */}
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
                          <td style={{ width: 80, padding: 4, textAlign: 'center', border: '1px solid #d5dbe0' }}>
                            {(() => {
                              let playerField = '';
                              if (user.name === ch.player1) playerField = 'player1_status';
                              else if (user.name === ch.player2) playerField = 'player2_status';
                              else if (user.name === ch.player3) playerField = 'player3_status';
                              else if (user.name === ch.player4) playerField = 'player4_status';
                              else return <span style={{ color: '#bbb' }}>-</span>;
                              const status = ch.status_log?.[playerField];
                              // 對應顯示與資料庫值
                              const displayOptions = [
                                { label: '考慮中', value: '未讀取' },
                                { label: '接受', value: '已接受' },
                                { label: '謝絕', value: '已拒絕' }
                              ];
                              // 狀態顏色
                              const selectColor = status === '已接受'
                                ? { color: '#22b573', fontWeight: 700 }
                                : status === '已拒絕'
                                  ? { color: '#d7263d', fontWeight: 700 }
                                  : { color: '#333' };
                              return (
                                <select
                                  value={displayOptions.find(opt => opt.value === status)?.label || '考慮中'}
                                  onChange={async (e) => {
                                    const selectedLabel = e.target.value;
                                    const selected = displayOptions.find(opt => opt.label === selectedLabel);
                                    console.log('[操作選單] 選擇:', selectedLabel, selected, ch, playerField, ch.status_code); // log 1
                                    if (!selected) return;
                                    const confirmMsg = `確定要將狀態改為「${selected.label}」嗎？`;
                                    if (!window.confirm(confirmMsg)) return;
                                    setActionLoading(ch.challenge_id);
                                    // 資料庫更新
                                    const { data: logRow, error: selectError } = await supabase
                                      .from('challenge_status_logs')
                                      .select('log_id')
                                      .eq('status_code', ch.status_code)
                                      .maybeSingle();
                                    console.log('[操作選單] 查詢 logRow:', logRow, selectError); // log 2
                                    if (!logRow) {
                                      alert('查無 logRow，請檢查 status_code');
                                      setActionLoading(null);
                                      return;
                                    }
                                    const updateObj: any = {};
                                    updateObj[playerField] = selected.value;
                                    console.log('[操作選單] updateObj:', updateObj, 'log_id:', logRow.log_id); // log 3
                                    const { error } = await supabase
                                      .from('challenge_status_logs')
                                      .update(updateObj)
                                      .eq('log_id', logRow.log_id);
                                    if (error) {
                                      alert('更新狀態失敗：' + error.message);
                                      console.error('[操作選單] Supabase update error:', error); // log 4
                                    } else {
                                      console.log('[操作選單] 狀態更新成功', updateObj); // log 5
                                      await fetchAll();
                                    }
                                    setActionLoading(null);
                                  }}
                                  style={{
                                    width: '80px',
                                    padding: '4px',
                                    ...selectColor,
                                    border: '1px solid #ccc',
                                    borderRadius: '6px',
                                    background: '#fff'
                                  }}
                                >
                                  {displayOptions.map(opt => (
                                    <option
                                      key={opt.value}
                                      value={opt.label}
                                      style={
                                        opt.value === '已接受'
                                          ? { color: '#22b573', fontWeight: 700 }
                                          : opt.value === '已拒絕'
                                            ? { color: '#d7263d', fontWeight: 700 }
                                            : {}
                                      }
                                    >
                                      {opt.label}
                                    </option>
                                  ))}
                                </select>
                              );
                            })()}
                          </td>
                          <td style={{ width: 60, textAlign: 'center' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                              <button
                                style={{ background: '#f5f5f5', border: '1px solid #ccc', borderRadius: 16, padding: '4px 10px', cursor: 'pointer' }}
                                title={ch.game_type === 'single' ? '前往單打頁面' : '前往雙打頁面'}
                                onClick={() => {
                                  console.log('DEBUG: ChallengeListPage 前往按鈕點擊，挑戰詳情:', ch); // Added debug log
                                  // 優先使用短格式ID
                                  const getIdByName = (name: string) => {
                                    // 先查找playerIdMap中是否有該玩家的短ID
                                    if (playerIdMap[name] && playerIdMap[name].shortId) {
                                      return playerIdMap[name].shortId || '';
                                    }
                                    // 回退到之前的方法
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
                                    
                                    // 如果有 match_detail_id，添加比賽相關參數
                                    if (ch.match_detail_id) {
                                      params.append('match_detail_id', ch.match_detail_id.toString());
                                      
                                      // 加入 contest_id（如果有映射）
                                      if (matchDetailToContestMap && matchDetailToContestMap[ch.match_detail_id]) {
                                        params.append('contest_id', matchDetailToContestMap[ch.match_detail_id].toString());
                                      }
                                      
                                      // 加入比賽名稱（如果有）
                                      if (contestNames && contestNames[ch.match_detail_id]) {
                                        params.append('contest_name', contestNames[ch.match_detail_id]);
                                      }
                                      
                                      // 標記為從戰況室來的
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
                                    
                                    // 添加比賽相關參數（如果有）
                                    if (ch.match_detail_id) {
                                      // 加入 match_detail_id
                                      params.append('match_detail_id', ch.match_detail_id.toString());
                                      
                                      // 加入 contest_id（如果有映射）
                                      if (matchDetailToContestMap && matchDetailToContestMap[ch.match_detail_id]) {
                                        params.append('contest_id', matchDetailToContestMap[ch.match_detail_id].toString());
                                      }
                                      
                                      // 加入比賽名稱（如果有）
                                      if (contestNames && contestNames[ch.match_detail_id]) {
                                        params.append('contest_name', contestNames[ch.match_detail_id]);
                                      }

                                      // 加入隊伍信息（如果有）
                                      if (teamInfoMap && teamInfoMap[ch.match_detail_id]) {
                                        const teamInfo = teamInfoMap[ch.match_detail_id];
                                        
                                        // 添加隊伍ID
                                        if (teamInfo.team1_id) {
                                          params.append('team1_id', teamInfo.team1_id.toString());
                                        }
                                        if (teamInfo.team2_id) {
                                          params.append('team2_id', teamInfo.team2_id.toString());
                                        }
                                        
                                        // 添加隊伍名稱
                                        if (teamInfo.team1_name) {
                                          params.append('team1_name', teamInfo.team1_name);
                                        }
                                        if (teamInfo.team2_name) {
                                          params.append('team2_name', teamInfo.team2_name);
                                        }
                                        
                                        // 添加隊伍成員陣列
                                        if (teamInfo.team1_members && teamInfo.team1_members.length > 0) {
                                          params.append('team1_members', JSON.stringify(teamInfo.team1_members));
                                        }
                                        if (teamInfo.team2_members && teamInfo.team2_members.length > 0) {
                                          params.append('team2_members', JSON.stringify(teamInfo.team2_members));
                                        }
                                      }
                                      
                                      // 標記為從戰況室來的
                                      params.append('from_battleroom', 'true');
                                    }
                                    
                                    navigate(`/double_game?${params.toString()}`);
                                  }
                                }}
                              >
                                <span style={{ fontWeight: 700, fontSize: 16 }}>→</span>
                              </button>
                              {/* 如果有 match_detail_id，顯示比賽名稱 */}
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
                          </td> {/* 加入前往按鈕 */}
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
              <div style={{ fontWeight: 600, color: '#d7263d', marginBottom: 4 }}>已過期</div>
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
                      <th style={{ width: 80, padding: 5, border: '1px solid #d5dbe0' }}>操作</th>
                      <th style={{ width: 60, textAlign: 'center' }}>前往</th> {/* 加入「前往」欄位 */}
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
                          <td style={{ width: 80, padding: 4, textAlign: 'center', border: '1px solid #d5dbe0' }}>
                            {(() => {
                              let playerField = '';
                              if (user.name === ch.player1) playerField = 'player1_status';
                              else if (user.name === ch.player2) playerField = 'player2_status';
                              else if (user.name === ch.player3) playerField = 'player3_status';
                              else if (user.name === ch.player4) playerField = 'player4_status';
                              else return <span style={{ color: '#bbb' }}>-</span>;
                              const status = ch.status_log?.[playerField];
                              if (status === '已接受') return renderStatus(status);
                              if (status === '已拒絕') return renderStatus(status);
                              // 過期且尚未回覆
                              return <span style={{ color: '#999' }}>已過期</span>;
                            })()}
                          </td>
                          <td style={{ width: 60, textAlign: 'center' }}>
                            <button
                              style={{ background: '#f5f5f5', border: '1px solid #ccc', borderRadius: 16, padding: '4px 10px', cursor: 'pointer' }}
                              title={ch.game_type === 'single' ? '前往單打頁面' : '前往雙打頁面'}
                              onClick={() => {
                                console.log('DEBUG: ChallengeListPage 前往按鈕點擊，挑戰詳情:', ch); // Added debug log
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
                                  
                                  // 如果有 match_detail_id，添加比賽相關參數
                                  if (ch.match_detail_id) {
                                    params.append('match_detail_id', ch.match_detail_id.toString());
                                    
                                    // 加入 contest_id（如果有映射）
                                    if (matchDetailToContestMap && matchDetailToContestMap[ch.match_detail_id]) {
                                      params.append('contest_id', matchDetailToContestMap[ch.match_detail_id].toString());
                                    }
                                    
                                    // 加入比賽名稱（如果有）
                                    if (contestNames && contestNames[ch.match_detail_id]) {
                                      params.append('contest_name', contestNames[ch.match_detail_id]);
                                    }
                                    
                                    // 標記為從戰況室來的
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
                                  
                                  // 如果有 match_detail_id，添加比賽相關參數
                                  if (ch.match_detail_id) {
                                    params.append('match_detail_id', ch.match_detail_id.toString());
                                    
                                    // 加入 contest_id（如果有映射）
                                    if (matchDetailToContestMap && matchDetailToContestMap[ch.match_detail_id]) {
                                      params.append('contest_id', matchDetailToContestMap[ch.match_detail_id].toString());
                                    }
                                    
                                    // 加入比賽名稱（如果有）
                                    if (contestNames && contestNames[ch.match_detail_id]) {
                                      params.append('contest_name', contestNames[ch.match_detail_id]);
                                    }
                                    
                                    // 標記為從戰況室來的
                                    params.append('from_battleroom', 'true');
                                  }
                                  
                                  navigate(`/double_game?${params.toString()}`);
                                }
                              }}
                            >
                              <span style={{ fontWeight: 700, fontSize: 16 }}>→</span>
                            </button>
                            {/* 如果有 match_detail_id，顯示 R 符號 */}
                            {ch.match_detail_id && (
                              <span style={{ color: 'red', fontWeight: 'bold', marginLeft: 4, fontSize: 16 }}>R</span>
                            )}
                          </td> {/* 加入前往按鈕 */}
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
                <div style={{ fontWeight: 500, color: '#1a7f37', marginBottom: 4 }}>尚未過期</div>
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
                            <td style={{ width: 80, padding: 4, textAlign: 'center', border: '1px solid #d5dbe0' }}>-</td>
                            <td style={{ width: 60, textAlign: 'center' }}>{/* 右側操作/前往按鈕區 */}-</td>
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
                <div style={{ fontWeight: 500, color: '#888', marginBottom: 4 }}>已過期</div>
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
                            <td style={{ width: 80, padding: 4, textAlign: 'center', border: '1px solid #d5dbe0' }}>-</td>
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
        </>
      )}
    </div>
  );
}
