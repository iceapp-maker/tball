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

  React.useEffect(() => {
    async function fetchMembers() {
      if (!user?.team_id) return;
      const { data, error } = await supabase.from('members').select('id, name, team_id').eq('team_id', user.team_id);
      if (!error && data) setMembers(data);
    }
    fetchMembers();
  }, [user?.team_id]);

  // 新增：獲取比賽名稱
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
      
      // 3. 使用 match_detail_id 查詢 contest_match_detail 表獲取 contest_id
      console.log('開始查詢 contest_match_detail 表...');
      const { data: matchDetails, error: matchDetailError } = await supabase
        .from('contest_match_detail')
        .select('match_detail_id, contest_id')
        .in('match_detail_id', matchDetailIds);
      
      console.log('從 contest_match_detail 表查詢到的資料:', matchDetails);
      console.log('查詢錯誤:', matchDetailError);
      
      if (!matchDetails || matchDetails.length === 0) {
        console.log('沒有在 contest_match_detail 表中找到記錄');
        return;
      }
      
      // 4. 建立 match_detail_id 到 contest_id 的映射
      const mdToContestIdMap: Record<number, number> = {};
      matchDetails.forEach((detail: any) => {
        if (detail.match_detail_id && detail.contest_id) {
          mdToContestIdMap[Number(detail.match_detail_id)] = Number(detail.contest_id);
        }
      });
      
      console.log('match_detail_id 到 contest_id 的映射:', mdToContestIdMap);
      
      // 5. 查詢 contest 表獲取比賽名稱
      const contestIds = Object.values(mdToContestIdMap);
      if (contestIds.length === 0) {
        console.log('沒有有效的 contest_id');
        return;
      }
      
      const { data: contests, error: contestError } = await supabase
        .from('contest')
        .select('contest_id, contest_name')
        .in('contest_id', contestIds);
      
      console.log('從 contest 表查詢到的資料:', contests);
      console.log('查詢錯誤:', contestError);
      
      if (!contests || contests.length === 0) {
        console.log('沒有在 contest 表中找到記錄');
        return;
      }
      
      // 6. 建立最終的映射: match_detail_id -> contest_name
      const nameMap: Record<number, string> = {};
      const idMap: Record<number, number> = {};
      
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
      
      setContestNames(nameMap);
      setMatchDetailToContestMap(idMap);
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
    setReceivedChallenges((receivedData || []).map(ch => ({ ...ch, status_log: logsMap[ch.status_code] || {} })));
    setInitiatedChallenges((initiatedData || []).map(ch => ({ ...ch, status_log: logsMap[ch.status_code] || {} })));
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
    }
    const updateLocalCount = () => {
      const pendingCount = receivedChallenges.filter(ch => {
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
      const count = receivedChallenges.filter(ch => {
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
    return receivedChallenges.filter(ch => {
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
  const activeChallenges = receivedChallenges.filter(ch => !isExpired(ch));

  // 將 initiatedChallenges 用 isExpired 分成 activeInitiated/expiredInitiated
  const expiredInitiated = initiatedChallenges.filter(isExpired);
  const activeInitiated = initiatedChallenges.filter(ch => !isExpired(ch));

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
                          <td style={{ width: 60, padding: 4, textAlign: 'center', border: '1px solid #d5dbe0' }}>{ch.initiator}</td>
                          <td style={{ width: 60, padding: 4, textAlign: 'center', border: '1px solid #d5dbe0' }}>{ch.player1 || '-'}</td>
                          <td style={{ width: 60, padding: 4, textAlign: 'center', border: '1px solid #d5dbe0' }}>{ch.player2 || '-'}</td>
                          <td style={{ width: 60, padding: 4, textAlign: 'center', border: '1px solid #d5dbe0' }}>{ch.player3 || '-'}</td>
                          <td style={{ width: 60, padding: 4, textAlign: 'center', border: '1px solid #d5dbe0' }}>{ch.player4 || '-'}</td>
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
                                      
                                      // 標記為從比賽來的
                                      params.append('from_contest', 'true');
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
                          <td style={{ width: 60, padding: 4, textAlign: 'center', border: '1px solid #d5dbe0' }}>{ch.initiator}</td>
                          <td style={{ width: 60, padding: 4, textAlign: 'center', border: '1px solid #d5dbe0' }}>{ch.player1 || '-'}</td>
                          <td style={{ width: 60, padding: 4, textAlign: 'center', border: '1px solid #d5dbe0' }}>{ch.player2 || '-'}</td>
                          <td style={{ width: 60, padding: 4, textAlign: 'center', border: '1px solid #d5dbe0' }}>{ch.player3 || '-'}</td>
                          <td style={{ width: 60, padding: 4, textAlign: 'center', border: '1px solid #d5dbe0' }}>{ch.player4 || '-'}</td>
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
