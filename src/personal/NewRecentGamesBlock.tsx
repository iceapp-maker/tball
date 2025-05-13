import React, { useContext, useEffect, useState } from 'react';
import { UserContext } from '../UserContext';
import { supabase } from '../supabaseClient';

const NewRecentGamesBlock: React.FC = () => {
  const { user } = useContext(UserContext) ?? { user: null };
  const [recentGames, setRecentGames] = useState<any[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth() + 1);
  const [availableMonths, setAvailableMonths] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const fetchGames = async () => {
      setLoading(true);
      setErrorMsg(null);
      if (!user) {
        setErrorMsg('請先登入');
        setLoading(false);
        return;
      }
      // 查詢單打
      const { data: singleGames } = await supabase
        .from('g_single_game')
        .select('*')
        .eq('team_id', user.team_id)
        .or(`player1.eq.${user.name},player2.eq.${user.name}`)
        .order('record_date', { ascending: false });
      // 查詢雙打
      const { data: doubleGames } = await supabase
        .from('g_double_game')
        .select('*')
        .eq('team_id', user.team_id)
        .or([
          `player1.eq.${user.name}`,
          `player2.eq.${user.name}`,
          `player3.eq.${user.name}`,
          `player4.eq.${user.name}`
        ].join(','))
        .order('record_date', { ascending: false });
      // 處理型態與勝負
      const singleGamesWithResult = (singleGames || []).map(game => ({
        ...game,
        type: '單打',
        partner: '--',
        opponent: game.player1 === user.name ? game.player2 : game.player1,
        score: game.score || '',
        result: game.win1_name === user.name ? '勝' : '負'
      }));
      const doubleGamesWithResult = (doubleGames || []).map(game => {
        let partner = '--';
        let opponent = '--';
        if (game.player1 === user.name) {
          partner = game.player2;
          opponent = `${game.player3} + ${game.player4}`;
        } else if (game.player2 === user.name) {
          partner = game.player1;
          opponent = `${game.player3} + ${game.player4}`;
        } else if (game.player3 === user.name) {
          partner = game.player4;
          opponent = `${game.player1} + ${game.player2}`;
        } else if (game.player4 === user.name) {
          partner = game.player3;
          opponent = `${game.player1} + ${game.player2}`;
        }
        return {
          ...game,
          type: '雙打',
          partner,
          opponent,
          score: game.score || '',
          result: (game.win1_name === user.name || game.win2_name === user.name) ? '勝' : '負'
        };
      });
      const allGames = [...singleGamesWithResult, ...doubleGamesWithResult]
        .sort((a, b) => new Date(b.record_date).getTime() - new Date(a.record_date).getTime());
      setRecentGames(allGames);
      // 統計有資料的月份
      const months = Array.from(
        new Set(allGames.map(g => {
          const isoDate = g.record_date.includes('T')
            ? g.record_date
            : `${g.record_date.replace(' ', 'T')}Z`;
          const date = new Date(isoDate);
          return date.getMonth() + 1;
        }))
      );
      setAvailableMonths(months);
      if (months.length > 0 && !months.includes(selectedMonth)) {
        setSelectedMonth(months[0]);
      }
      setLoading(false);
    };
    fetchGames();
  }, [user]);

  if (loading) return <div className="mb-6 p-4 bg-gray-50 rounded shadow">載入中...</div>;
  if (errorMsg) return <div className="mb-6 p-4 bg-red-50 rounded shadow text-red-600">{errorMsg}</div>;

  // 根據選擇的月份篩選資料
  const filteredGames = recentGames.filter((g: any) => {
    const isoDate = g.record_date.includes('T')
      ? g.record_date
      : `${g.record_date.replace(' ', 'T')}Z`;
    const date = new Date(isoDate);
    return date.getMonth() + 1 === selectedMonth;
  });

  return (
    <div className="mb-6 p-4 bg-gray-50 rounded shadow">
      <h3 className="font-bold mb-2 text-lg">近期對戰紀錄</h3>
      <div className="flex gap-2 mb-2 flex-wrap">
        {[1,2,3,4,5,6,7,8,9,10,11,12].map(month => {
          const hasData = availableMonths.includes(month);
          const count = recentGames.filter(g => {
            const isoDate = g.record_date.includes('T')
              ? g.record_date
              : `${g.record_date.replace(' ', 'T')}Z`;
            const date = new Date(isoDate);
            return date.getMonth() + 1 === month;
          }).length;
          return (
            <span key={month} className="relative inline-block">
              <button
                disabled={!hasData}
                className={`px-2 py-1 border rounded transition-all duration-200
                  ${hasData ? 'bg-blue-100 font-bold text-blue-800 border-blue-400' : 'bg-gray-100 text-gray-400 border-gray-200'}
                  ${selectedMonth === month && hasData ? 'bg-blue-400 text-white border-blue-700' : ''}
                `}
                onClick={() => setSelectedMonth(month)}
                style={{ minWidth: 40 }}
              >
                {month}月
              </button>
              {hasData && (
                <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs rounded-full px-1 min-w-[20px] text-center shadow">
                  {count}
                </span>
              )}
            </span>
          );
        })}
      </div>
      <div style={{ maxHeight: '220px', overflowY: 'auto' }}>
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
            </tr>
          </thead>
          <tbody>
            {filteredGames.length === 0 ? (
              <tr><td colSpan={7}>無紀錄</td></tr>
            ) : (
              filteredGames.map((game: any, idx: number) => {
                const date = game.record_date ? new Date(game.record_date) : null;
                const dateStr = date ? `${date.getMonth() + 1}/${date.getDate()}` : '';
                return (
                  <tr key={game.id || idx}>
                    <td className="border px-2">{idx + 1}</td>
                    <td className="border px-2">{dateStr}</td>
                    <td className="border px-2">{game.type}</td>
                    <td className="border px-2">{game.partner}</td>
                    <td className="border px-2">{game.opponent}</td>
                    <td className="border px-2">{game.score}</td>
                    <td className="border px-2">{game.result}</td>
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
export default NewRecentGamesBlock; 