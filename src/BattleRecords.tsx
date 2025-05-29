import React, { useEffect, useState, useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, LabelList } from "recharts";
import { supabase } from "./supabaseClient";
import { useUser } from './UserContext';

interface ScoreSummary {
  name: string;
  points: number;
  team_id: string;
  month: number;
  year: number;
  rank: number;
  winning_rate?: number;
  total_games: number;
  win_games?: number;
  source_type: string;
  game_type_name: string;
}

const TEAM_NAMES: Record<string, string> = {
  'F': '復華',
  'M': '明興',
  'T': '測試',
  // 其他團隊可依需求擴充
};

// 比賽類型選項
const GAME_TYPE_OPTIONS = [
  { value: 'all', label: '全部比賽' },
  { value: 'challenge', label: '挑戰賽' },
  { value: 'contest', label: '正式比賽' }
];

// 取得登入者資訊（優先用 props，其次 localStorage，否則顯示訪客）
function getCurrentUser() {
  try {
    const userStr = localStorage.getItem('loginUser');
    if (userStr) {
      return JSON.parse(userStr);
    }
  } catch {}
  return null;
}

// 支援 props 傳遞登入資訊
const BattleRecords: React.FC<{ currentLoggedInUser?: any }> = ({ currentLoggedInUser }) => {
  const [allData, setAllData] = useState<ScoreSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<any>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [total, setTotal] = useState(0); 
  const pageSize = 10;
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth() + 1);
  const [selectedGameType, setSelectedGameType] = useState<string>('all'); // 新增比賽類型篩選
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null);
  const [playerRecords, setPlayerRecords] = useState<any[]>([]);
  const [allRecords, setAllRecords] = useState<any[]>([]);
  const [showAll, setShowAll] = useState(true);
  const [yearlyScore, setYearlyScore] = useState<{
    totalPoints: number;
    rank: number;
    totalMembers: number;
  } | null>(null);

  // 直接在 function body 計算 user 與 teamId/teamName，確保查詢與標題一致
  const user = currentLoggedInUser || getCurrentUser();
  const teamId = user?.team_id || 'T';
  const teamName = TEAM_NAMES[teamId] || teamId;

  // 獲取所有有積分的成員數據
  useEffect(() => {
    const fetchAllData = async () => {
      setLoading(true);
      setErrorMsg(null);
      
      const targetTeamId = user?.team_id || 'T';
      
      // 建立查詢條件
      let query = supabase
        .from('member_monthly_score_summary')
        .select('*', { count: 'exact' })
        .eq('team_id', targetTeamId)
        .eq('year', selectedYear)
        .eq('month', selectedMonth)
        .gt('points', 0)
        .gt('total_games', 0);
      
      // 根據選擇的比賽類型添加篩選條件
      if (selectedGameType !== 'all') {
        query = query.eq('source_type', selectedGameType);
      }
      
      const { data, error, count } = await query.order('points', { ascending: false });
      
      if (error) {
        setErrorMsg('資料查詢失敗: ' + error.message);
        setAllData([]);
      } else {
        setAllData(data || []);
        setTotal(count || 0);
      }
      
      setLoading(false);
    };
    
    fetchAllData();
  }, [teamId, selectedYear, selectedMonth, selectedGameType]); // 新增 selectedGameType 依賴

  // 獲取所有比賽記錄
  const fetchAllRecords = async () => {
    setLoading(true);
    
    // 查詢單打
    let singleQuery = supabase
      .from("g_single_game")
      .select("*")
      .eq("team_id", teamId);
    
    // 查詢雙打
    let doubleQuery = supabase
      .from("g_double_game")
      .select("*")
      .eq("team_id", teamId);
    
    // 根據選擇的比賽類型添加篩選條件
    if (selectedGameType !== 'all') {
      singleQuery = singleQuery.eq('source_type', selectedGameType);
      doubleQuery = doubleQuery.eq('source_type', selectedGameType);
    }
    
    const { data: single } = await singleQuery.order("record_date", { ascending: false });
    const { data: double } = await doubleQuery.order("record_date", { ascending: false });
    
    setAllRecords([...(single || []), ...(double || [])]);
    setLoading(false);
  };

  useEffect(() => {
    fetchAllRecords();
  }, [teamId, selectedGameType]); // 新增 selectedGameType 依賴

  // 搜尋自己跳到對應頁面
  const handleCenterSelf = async () => {
    if (!user) return;
    
    setLoading(true);
    
    // 建立查詢條件
    let query = supabase
      .from('member_monthly_score_summary')
      .select('*')
      .eq('team_id', teamId)
      .eq('year', selectedYear)
      .eq('month', selectedMonth)
      .gt('points', 0)
      .gt('total_games', 0);
    
    // 根據選擇的比賽類型添加篩選條件
    if (selectedGameType !== 'all') {
      query = query.eq('source_type', selectedGameType);
    }
    
    const { data: allMembers, error } = await query.order('points', { ascending: false });

    if (error || !allMembers) {
      setErrorMsg('查詢失敗');
      setLoading(false);
      return;
    }
    
    const idx = allMembers.findIndex(m => m.name === user.name);
    
    if (idx !== -1) {
      const page = Math.floor(idx / 5) + 1;
      setCurrentPage(page);
      setChartPage(page);
      
      // 自動獲取並顯示自己的比賽記錄
      setSelectedPlayer(user.name);
      setShowAll(false);
      await fetchPlayerRecords(user.name);
    } else {
      setErrorMsg('找不到自己的紀錄');
    }
    
    setLoading(false);
  };

  // 獲取指定玩家的比賽記錄
  const fetchPlayerRecords = async (playerName: string) => {
    setLoading(true);
    
    // 查詢單打
    let singleQuery = supabase
      .from("g_single_game")
      .select("*")
      .eq("team_id", teamId)
      .or(`player1.eq.${playerName},player2.eq.${playerName}`);
    
    // 查詢雙打
    let doubleQuery = supabase
      .from("g_double_game")
      .select("*")
      .eq("team_id", teamId)
      .or([
        `player1.eq.${playerName}`,
        `player2.eq.${playerName}`,
        `player3.eq.${playerName}`,
        `player4.eq.${playerName}`
      ].join(","));
    
    // 根據選擇的比賽類型添加篩選條件
    if (selectedGameType !== 'all') {
      singleQuery = singleQuery.eq('source_type', selectedGameType);
      doubleQuery = doubleQuery.eq('source_type', selectedGameType);
    }
    
    const { data: singleGames } = await singleQuery.order("record_date", { ascending: false });
    const { data: doubleGames } = await doubleQuery.order("record_date", { ascending: false });
    
    // 處理型態與勝負
    const singleGamesWithResult = (singleGames || []).map(game => ({
      ...game,
      type: "單打",
      partner: "--",
      opponent: game.player1 === playerName ? game.player2 : game.player1,
      score: game.score || "",
      result: game.win1_name === playerName ? "勝" : "負"
    }));
    
    const doubleGamesWithResult = (doubleGames || []).map(game => {
      let partner = "--";
      let opponent = "--";
      
      if (game.player1 === playerName) {
        partner = game.player2;
        opponent = `${game.player3} + ${game.player4}`;
      } else if (game.player2 === playerName) {
        partner = game.player1;
        opponent = `${game.player3} + ${game.player4}`;
      } else if (game.player3 === playerName) {
        partner = game.player4;
        opponent = `${game.player1} + ${game.player2}`;
      } else if (game.player4 === playerName) {
        partner = game.player3;
        opponent = `${game.player1} + ${game.player2}`;
      }
      
      return {
        ...game,
        type: "雙打",
        partner,
        opponent,
        score: game.score || "",
        result: (game.win1_name === playerName || game.win2_name === playerName) ? "勝" : "負"
      };
    });
    
    const allGames = [...singleGamesWithResult, ...doubleGamesWithResult]
      .sort((a, b) => new Date(b.record_date).getTime() - new Date(a.record_date).getTime());
    
    setPlayerRecords(allGames);
    setLoading(false);
  };

  // 點擊 bar 時顯示該玩家記錄
  const handleBarClick = async (data: any) => {
    if (!data || !data.activeLabel) return;
    const playerName = data.activeLabel;
    setSelectedPlayer(playerName);
    setShowAll(false);
    await fetchPlayerRecords(playerName);
  };

  // 顯示全部記錄
  const handleShowAll = async () => {
    setShowAll(true);
    setSelectedPlayer(null);
    await fetchAllRecords();
  };

  // 分頁按鈕 UI
  const renderPagination = () => {
    const totalPages = Math.ceil(total / pageSize);
    
    return (
      <div className="flex gap-2 mt-1 overflow-x-auto justify-center">
        <button 
          disabled={currentPage === 1} 
          onClick={() => setCurrentPage(p => Math.max(1, p - 1))} 
          className="px-2 py-1 border rounded disabled:opacity-50"
        >&lt;</button>
        
        {Array.from({ length: Math.min(totalPages, 15) }).map((_, i) => (
          <button
            key={i + 1}
            onClick={() => setCurrentPage(i + 1)}
            className={`px-2 py-1 border rounded ${currentPage === i + 1 ? 'bg-blue-200' : ''}`}
          >{i + 1}</button>
        ))}
        
        <button 
          disabled={currentPage === totalPages} 
          onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} 
          className="px-2 py-1 border rounded disabled:opacity-50"
        >&gt;</button>
      </div>
    );
  };

  // 條形圖分頁
  const [chartPage, setChartPage] = useState(1);
  const chartPageSize = 5;
  const chartTotalPages = Math.ceil(allData.length / chartPageSize);
  const chartPageData = useMemo(() => {
    // 取得分頁內的資料
    const pageData = allData.slice((chartPage - 1) * chartPageSize, chartPage * chartPageSize);
    // 確保每筆資料有 winning_rate 欄位
    return pageData.map(row => {
      if (typeof row.winning_rate === 'number') return row;
      // 若沒有 winning_rate，動態計算
      let rate = 0;
      if (typeof row.win_games === 'number' && typeof row.total_games === 'number' && row.total_games > 0) {
        rate = (row.win_games / row.total_games) * 100;
      }
      return { ...row, winning_rate: Number(rate.toFixed(1)) };
    });
  }, [allData, chartPage]);

  // 自訂 Tooltip
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const item = payload[0].payload;
      return (
        <div className="bg-white p-2 rounded shadow text-sm">
          <div className="font-bold mb-1">{label}</div>
          <div>類型：{item.game_type_name || '--'}</div>
          <div>points：{item.points}</div>
          <div>勝率：{item.winning_rate ?? '--'}</div>
          <div>總場次：{item.total_games}</div>
        </div>
      );
    }
    return null;
  };

  // 取得比賽類型的樣式
  const getGameTypeStyle = (sourceType: string) => {
    switch (sourceType) {
      case 'challenge':
        return {
          color: '#059669', // 綠色文字
          borderBottom: '2px solid #10b981', // 綠色底線
          fontWeight: 'bold'
        };
      case 'contest':
        return {
          color: '#dc2626', // 紅色文字
          borderBottom: '2px solid #ef4444', // 紅色底線
          fontWeight: 'bold'
        };
      default:
        return {};
    }
  };

  // 取得比賽類型符號
  const getGameTypeSymbol = (sourceType: string) => {
    switch (sourceType) {
      case 'challenge':
        return '⚡'; // 挑戰賽用閃電
      case 'contest':
        return '🏆'; // 正式比賽用獎盃
      default:
        return '';
    }
  };

  // 對戰紀錄表格元件（可複用）
  const BattleRecordTable: React.FC<{ records: any[]; playerName?: string }> = ({ records, playerName }) => {
    // 取得所有有資料的月份
    const availableMonths = Array.from(new Set(records.map(g => new Date(g.record_date).getMonth() + 1)));
    const [tableMonth, setTableMonth] = useState<number>(availableMonths.length > 0 ? availableMonths[0] : new Date().getMonth() + 1);
    
    useEffect(() => {
      if (availableMonths.length > 0 && !availableMonths.includes(tableMonth)) {
        setTableMonth(availableMonths[0]);
      }
    }, [records, availableMonths]);
    
    const filteredGames = records.filter(g => {
      // 處理後端兩種日期格式 (含T或不含T)
      const isoDate = g.record_date.includes('T') 
        ? g.record_date 
        : `${g.record_date.replace(' ', 'T')}Z`;
      
      const date = new Date(isoDate);
      
      // 偵錯日誌 (開發用)
      console.debug('[時區檢查]', {
        輸入日期: g.record_date,
        標準化格式: isoDate,
        UTC月份: date.getUTCMonth() + 1,
        本地月份: date.getMonth() + 1
      });
    
      return date.getUTCFullYear() === selectedYear && 
             date.getUTCMonth() + 1 === tableMonth;
    });

    return (
      <div className="mt-8">
        <h2 className="mb-2 font-bold">
          {playerName ? `${playerName} ` : ''}對戰紀錄月份
          {selectedGameType !== 'all' && (
            <span className="ml-2 text-sm text-blue-600">
              ({GAME_TYPE_OPTIONS.find(opt => opt.value === selectedGameType)?.label})
            </span>
          )}
        </h2>
        
        {/* 比賽類型圖例說明 */}
        {selectedGameType === 'all' && (
          <div className="mb-3 p-2 bg-gray-50 rounded text-sm">
            <span className="font-bold mr-3">比賽類型：</span>
            <span className="mr-4">⚡ 挑戰賽</span>
            <span>🏆 正式比賽</span>
          </div>
        )}
        
        <div className="flex gap-2 mb-2">
          {[1,2,3,4,5,6].map(m => (
            <span key={m} className="relative inline-block">
              <button
                disabled={!availableMonths.includes(m)}
                className={`px-2 py-1 border rounded transition-all duration-200
                  ${availableMonths.includes(m) ? 'bg-blue-100 font-bold text-blue-800 border-blue-400' : 'bg-gray-100 text-gray-400 border-gray-200'}
                  ${tableMonth === m ? 'bg-blue-400 text-white border-blue-700' : ''}
                  `}
                onClick={() => setTableMonth(m)}
                style={{ minWidth: 40 }}
              >
                {m}月
              </button>
              {availableMonths.includes(m) && (
                <span className="absolute -top-2 -right-2 bg-blue-500 text-white text-xs rounded-full px-1.5 py-0.5">
                  {records.filter(g => {
                    const isoDate = g.record_date.includes('T') 
                      ? g.record_date 
                      : `${g.record_date.replace(' ', 'T')}Z`;
                    const date = new Date(isoDate);
                    return date.getUTCFullYear() === selectedYear && date.getUTCMonth() + 1 === m;
                  }).length}
                </span>
              )}
            </span>
          ))}
        </div>
        <div className="flex gap-2 mb-2">
          {[7,8,9,10,11,12].map(m => (
            <span key={m} className="relative inline-block">
              <button
                disabled={!availableMonths.includes(m)}
                className={`px-2 py-1 border rounded transition-all duration-200
                  ${availableMonths.includes(m) ? 'bg-blue-100 font-bold text-blue-800 border-blue-400' : 'bg-gray-100 text-gray-400 border-gray-200'}
                  ${tableMonth === m ? 'bg-blue-400 text-white border-blue-700' : ''}
                  `}
                onClick={() => setTableMonth(m)}
                style={{ minWidth: 40 }}
              >
                {m}月
              </button>
              {availableMonths.includes(m) && (
                <span className="absolute -top-2 -right-2 bg-blue-500 text-white text-xs rounded-full px-1.5 py-0.5">
                  {records.filter(g => {
                    const isoDate = g.record_date.includes('T') 
                      ? g.record_date 
                      : `${g.record_date.replace(' ', 'T')}Z`;
                    const date = new Date(isoDate);
                    return date.getUTCFullYear() === selectedYear && date.getUTCMonth() + 1 === m;
                  }).length}
                </span>
              )}
            </span>
          ))}
        </div>
        <h2 className="mb-2 font-bold">{tableMonth}月所有對戰</h2>
        <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
          <table className="min-w-full border text-center">
            <thead>
              <tr>
                <th className="border px-2">#</th>
                <th className="border px-2">日期</th>
                <th className="border px-2">類型</th>
                <th className="border px-2">搭檔</th>
                <th className="border px-2">對手</th>
                <th className="border px-2">比分</th>
                <th className="border px-2">勝負</th>
                <th className="border px-2">類型</th>
              </tr>
            </thead>
            <tbody>
              {filteredGames.length === 0 ? (
                <tr><td colSpan={8}>無紀錄</td></tr>
              ) : (
                filteredGames.map((game, idx) => {
                  const date = game.record_date ? new Date(game.record_date) : null;
                  const dateStr = date ? `${date.getMonth() + 1}/${date.getDate()}` : '';
                  const gameTypeSymbol = getGameTypeSymbol(game.source_type);
                  
                  return (
                    <tr key={game.id || idx}>
                      <td className="border px-2">{idx + 1}</td>
                      <td className="border px-2">{dateStr}</td>
                      <td className="border px-2">{game.type}</td>
                      <td className="border px-2">{game.partner}</td>
                      <td className="border px-2">{game.opponent}</td>
                      <td className="border px-2">{game.score}</td>
                      <td className="border px-2">{game.result}</td>
                      <td className="border px-2 text-lg">{gameTypeSymbol}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // 全部對戰紀錄表格
  const AllBattleRecordTable: React.FC<{ records: any[] }> = ({ records }) => {
    // 取得所有有資料的月份
    const availableMonths = Array.from(new Set(records.map(g => g.record_date ? new Date(g.record_date).getMonth() + 1 : null).filter(Boolean)));
    const [tableMonth, setTableMonth] = useState<number>(availableMonths.length > 0 ? availableMonths[0] : new Date().getMonth() + 1);
    
    useEffect(() => {
      if (availableMonths.length > 0 && !availableMonths.includes(tableMonth)) {
        setTableMonth(availableMonths[0]);
      }
    }, [records, availableMonths]);
    
    const filteredGames = records.filter(g => g.record_date && new Date(g.record_date).getMonth() + 1 === tableMonth);

    return (
      <div className="mt-8">
        <h2 className="mb-2 font-bold">
          所有成員對戰紀錄月份
          {selectedGameType !== 'all' && (
            <span className="ml-2 text-sm text-blue-600">
              ({GAME_TYPE_OPTIONS.find(opt => opt.value === selectedGameType)?.label})
            </span>
          )}
        </h2>
        
        {/* 比賽類型圖例說明 */}
        {selectedGameType === 'all' && (
          <div className="mb-3 p-2 bg-gray-50 rounded text-sm">
            <span className="font-bold mr-3">比賽類型：</span>
            <span className="mr-4">⚡ 挑戰賽</span>
            <span>🏆 正式比賽</span>
          </div>
        )}
        
        <div className="flex gap-2 mb-2">
          {[1,2,3,4,5,6].map(m => (
            <span key={m} className="relative inline-block">
              <button
                disabled={!availableMonths.includes(m)}
                className={`px-2 py-1 border rounded transition-all duration-200
                  ${availableMonths.includes(m) ? 'bg-blue-100 font-bold text-blue-800 border-blue-400' : 'bg-gray-100 text-gray-400 border-gray-200'}
                  ${tableMonth === m ? 'bg-blue-400 text-white border-blue-700' : ''}
                  `}
                onClick={() => setTableMonth(m)}
                style={{ minWidth: 40 }}
              >
                {m}月
              </button>
              {availableMonths.includes(m) && (
                <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs rounded-full px-1 min-w-[20px] text-center shadow">
                  {records.filter(g => g.record_date && new Date(g.record_date).getMonth() + 1 === m).length}
                </span>
              )}
            </span>
          ))}
        </div>
        <div className="flex gap-2 mb-2">
          {[7,8,9,10,11,12].map(m => (
            <span key={m} className="relative inline-block">
              <button
                disabled={!availableMonths.includes(m)}
                className={`px-2 py-1 border rounded transition-all duration-200
                  ${availableMonths.includes(m) ? 'bg-blue-100 font-bold text-blue-800 border-blue-400' : 'bg-gray-100 text-gray-400 border-gray-200'}
                  ${tableMonth === m ? 'bg-blue-400 text-white border-blue-700' : ''}
                  `}
                onClick={() => setTableMonth(m)}
                style={{ minWidth: 40 }}
              >
                {m}月
              </button>
              {availableMonths.includes(m) && (
                <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs rounded-full px-1 min-w-[20px] text-center shadow">
                  {records.filter(g => g.record_date && new Date(g.record_date).getMonth() + 1 === m).length}
                </span>
              )}
            </span>
          ))}
        </div>
        <h2 className="mb-2 font-bold">{tableMonth}月所有對戰</h2>
        <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
          <table className="min-w-full border text-center">
            <thead>
              <tr>
                <th className="border px-2">#</th>
                <th className="border px-2">日期</th>
                <th className="border px-2">player1</th>
                <th className="border px-2">player2</th>
                <th className="border px-2">player3</th>
                <th className="border px-2">player4</th>
                <th className="border px-2">比數</th>
                <th className="border px-2">類型</th>
              </tr>
            </thead>
            <tbody>
              {filteredGames.length === 0 ? (
                <tr><td colSpan={8}>無紀錄</td></tr>
              ) : (
                filteredGames.map((game, idx) => {
                  const date = game.record_date ? new Date(game.record_date) : null;
                  const dateStr = date ? `${date.getMonth() + 1}/${date.getDate()}` : '';
                  const gameTypeSymbol = getGameTypeSymbol(game.source_type);
                  
                  return (
                    <tr key={game.id || idx}>
                      <td className="border px-2">{idx + 1}</td>
                      <td className="border px-2">{dateStr}</td>
                      <td className="border px-2">{game.player1 || '--'}</td>
                      <td className="border px-2">{game.player2 || '--'}</td>
                      <td className="border px-2">{game.player3 || '--'}</td>
                      <td className="border px-2">{game.player4 || '--'}</td>
                      <td className="border px-2">{game.score || '--'}</td>
                      <td className="border px-2 text-lg">{gameTypeSymbol}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // 根據當前頁面獲取顯示的數據
  const currentPageData = allData.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  // 取得當前選擇的比賽類型名稱
  const currentGameTypeName = GAME_TYPE_OPTIONS.find(opt => opt.value === selectedGameType)?.label || '全部比賽';

  // 新增獲取年度總積分的函數
  const fetchYearlyScore = async () => {
    if (!user) return;
    
    try {
      // 查詢該使用者全年度所有月份的積分（不限制比賽類型）
      const { data: userYearlyData, error: userError } = await supabase
        .from('member_monthly_score_summary')
        .select('points')
        .eq('team_id', teamId)
        .eq('year', selectedYear)
        .eq('name', user.name)
        .gt('points', 0);

      if (userError) {
        console.error('查詢用戶年度積分失敗:', userError);
        return;
      }

      // 計算用戶總積分
      const userTotalPoints = (userYearlyData || []).reduce((sum, record) => sum + record.points, 0);

      // 查詢所有成員的年度積分來計算排名
      const { data: allMembersData, error: allError } = await supabase
        .from('member_monthly_score_summary')
        .select('name, points')
        .eq('team_id', teamId)
        .eq('year', selectedYear)
        .gt('points', 0);

      if (allError) {
        console.error('查詢所有成員年度積分失敗:', allError);
        return;
      }

      // 按成員分組並計算每個成員的年度總積分
      const memberTotals = new Map<string, number>();
      (allMembersData || []).forEach(record => {
        const currentTotal = memberTotals.get(record.name) || 0;
        memberTotals.set(record.name, currentTotal + record.points);
      });

      // 轉換為陣列並排序
      const sortedMembers = Array.from(memberTotals.entries())
        .map(([name, points]) => ({ name, points }))
        .sort((a, b) => b.points - a.points);

      // 找到用戶排名
      const userRank = sortedMembers.findIndex(member => member.name === user.name) + 1;
      const totalMembers = sortedMembers.length;

      setYearlyScore({
        totalPoints: userTotalPoints,
        rank: userRank,
        totalMembers
      });

    } catch (error) {
      console.error('獲取年度積分時發生錯誤:', error);
    }
  };

  // 在現有的 useEffect 中添加年度積分查詢
  useEffect(() => {
    fetchYearlyScore();
  }, [teamId, selectedYear, user]); // 當團隊、年份或用戶改變時重新查詢

  return (
    <div className="max-w-3xl mx-auto p-2 sm:p-6 overflow-x-auto">
      <div className="mb-2 text-gray-700 text-sm">
        {user
          ? <span>登入者：{user.name}（{TEAM_NAMES[user.team_id] || user.team_id}）</span>
          : <span>登入者：訪客（測試）</span>
        }
      </div>
      
      {/* 新增：年度總積分顯示 */}
      {user && yearlyScore && (
        <div className="mb-4 p-3 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg">
          <div className="text-lg font-bold text-blue-800">
            {user.name}, {selectedYear}年度總積分為: {yearlyScore.totalPoints}分，總排名: {yearlyScore.rank}名
            <span className="text-sm text-gray-600 ml-2">
              (共{yearlyScore.totalMembers}名成員)
            </span>
          </div>
        </div>
      )}
      
      <h2 className="text-2xl font-bold mb-4">
        {teamName} {selectedYear} 年 {selectedMonth} 月積分 - {currentGameTypeName}
      </h2>
      
      {/* 添加圖例說明 */}
      {selectedGameType === 'all' && (
        <div className="mb-4 p-3 bg-gray-50 rounded-lg">
          <h3 className="text-sm font-bold mb-2">比賽類型圖例：</h3>
          <div className="flex gap-4 text-sm">
            <div className="flex items-center gap-1">
              <span>⚡</span>
              <span style={{ color: '#059669', fontWeight: 'bold' }}>挑戰賽</span>
            </div>
            <div className="flex items-center gap-1">
              <span>🏆</span>
              <span style={{ color: '#dc2626', fontWeight: 'bold' }}>正式比賽</span>
            </div>
          </div>
        </div>
      )}
      
      <div className="flex flex-wrap gap-2 mb-4">
        <button
          className="px-2 py-1 text-xs sm:text-sm bg-blue-500 text-white rounded"
          onClick={handleCenterSelf}
          disabled={!user}
        >搜尋自己</button>
        
        {/* 年份、月份、比賽類型選擇 */}
        <div className="flex ml-4 gap-2">
          <select 
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
            className="text-xs sm:text-sm border rounded"
          >
            {[2024, 2025].map(year => (
              <option key={year} value={year}>{year}年</option>
            ))}
          </select>
          
          <select 
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(Number(e.target.value))}
            className="text-xs sm:text-sm border rounded"
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map(month => (
              <option key={month} value={month}>{month}月</option>
            ))}
          </select>
          
          {/* 新增比賽類型選擇器 */}
          <select 
            value={selectedGameType}
            onChange={(e) => setSelectedGameType(e.target.value)}
            className="text-xs sm:text-sm border rounded"
          >
            {GAME_TYPE_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
      </div>
      
      {loading ? (
        <div>載入中...</div>
      ) : errorMsg ? (
        <div className="text-red-600 mb-2">{errorMsg}</div>
      ) : currentPageData.length === 0 ? (
        <div className="text-gray-600 mb-2">查無資料</div>
      ) : (
        <div
          className="w-full"
          style={{ minWidth: `${Math.max(chartPageData.length * 60, 350)}px`, height: 320 }}
        >
          <ResponsiveContainer width="100%" height={300}>
            <BarChart
              data={chartPageData}
              margin={{ top: 32, right: 16, left: 8, bottom: 32 }}
              onClick={handleBarClick}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="name"
                tick={{ angle: -40, fontSize: 10, dy: 10 }}
                interval={0}
              />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="points" fill="#3182ce">
                {/* 只保留 bar 內部顯示勝率 */}
                <LabelList
                  dataKey="winning_rate"
                  position="inside"
                  formatter={(v: number | undefined) => (typeof v === 'number' ? `${v.toFixed(1)}%` : '')}
                  style={{ fontSize: 11, fill: '#fff' }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          {/* 分頁按鈕緊貼在圖表下方 */}
          {chartTotalPages > 1 && (
            <div className="flex gap-2 mt-0 overflow-x-auto justify-center">
              <button
                className="px-2 py-1 border rounded"
                disabled={chartPage === 1}
                onClick={() => setChartPage(chartPage - 1)}
              >&lt;</button>
              {Array.from({ length: chartTotalPages }).map((_, i) => (
                <button
                  key={i + 1}
                  className={`px-2 py-1 border rounded ${chartPage === i + 1 ? 'bg-blue-500 text-white font-bold' : 'bg-white text-gray-700'}`}
                  onClick={() => setChartPage(i + 1)}
                >{i + 1}</button>
              ))}
              <button
                className="px-2 py-1 border rounded"
                disabled={chartPage === chartTotalPages}
                onClick={() => setChartPage(chartPage + 1)}
              >&gt;</button>
            </div>
          )}
        </div>
      )}
      
      {/* 下方顯示對應玩家的對戰紀錄表或預設全部資料 */}
      {showAll ? (
        <>
          <button className="mb-2 px-3 py-1 border rounded bg-blue-100 hover:bg-blue-200" onClick={handleShowAll} disabled>顯示全部</button>
          <div className="overflow-x-auto">
            <AllBattleRecordTable records={allRecords} />
          </div>
        </>
      ) : (
        <>
          <button className="mb-2 px-3 py-1 border rounded bg-gray-100 hover:bg-blue-100" onClick={handleShowAll}>顯示全部</button>
          {playerRecords.length > 0 ? (
            <BattleRecordTable records={playerRecords} playerName={selectedPlayer || undefined} />
          ) : (
            <div className="mt-8 text-gray-500">請點擊上方長條圖中的玩家，查看該玩家的對戰紀錄</div>
          )}
        </>
      )}
      
      {/* 成員積分表格 */}
      <div className="overflow-x-auto mt-4">
        <table className="table-auto min-w-fit border border-gray-300 rounded">
          <thead>
            <tr>
              <th className="border px-2">#</th>
              <th className="border px-2">名稱</th>
              <th className="border px-2">積分</th>
              <th className="border px-2">勝率</th>
              <th className="border px-2">總場次</th>
              <th className="border px-2">類型</th>
            </tr>
          </thead>
          <tbody>
            {currentPageData.length === 0 ? (
              <tr><td colSpan={6}>無紀錄</td></tr>
            ) : (
              currentPageData.map((row, idx) => {
                const gameTypeSymbol = getGameTypeSymbol(row.source_type);
                
                return (
                  <tr key={row.name} className={selectedPlayer === row.name ? "bg-blue-50" : ""}>
                    <td className="border px-2">{(currentPage - 1) * pageSize + idx + 1}</td>
                    <td className="border px-2">{row.name}</td>
                    <td className="border px-2">{row.points}</td>
                    <td className="border px-2">{row.winning_rate ?? '--'}</td>
                    <td className="border px-2">{row.total_games}</td>
                    <td className="border px-2 text-lg">{gameTypeSymbol}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        {renderPagination()}
      </div>
    </div>
  );
};

export default BattleRecords;
