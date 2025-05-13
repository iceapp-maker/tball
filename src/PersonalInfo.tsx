import React, { useEffect, useState, useContext } from "react";
import { supabase } from "./supabaseClient";
import { UserContext } from "./UserContext";

interface PersonalStats {
  name: string;
  email?: string;
  team_id: string;
  role?: string;
  points: number;
  rank: number;
  winning_rate?: number;
  total_games?: number;
  win_games?: number;
  best_points?: number;
  best_rank?: number;
  total_win_games?: number;
  total_played_games?: number;
}

const TEAM_NAMES: Record<string, string> = {
  'F': '復華',
  'M': '明興',
  'T': '測試',
};

const PersonalInfo: React.FC = () => {
  const { user } = useContext(UserContext) ?? { user: null };
  const [stats, setStats] = useState<PersonalStats | null>(null);
  const [recentGames, setRecentGames] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getUTCMonth() + 1);
  const [availableMonths, setAvailableMonths] = useState<number[]>([]);
  const [acceptedChallenges, setAcceptedChallenges] = useState<any[]>([]);
  const [acceptedContests, setAcceptedContests] = useState<any[]>([]);

  useEffect(() => {
    const fetchPersonalInfo = async () => {
      setLoading(true);
      setErrorMsg(null);
      if (!user) {
        setErrorMsg("請先登入");
        setLoading(false);
        return;
      }
      // 查詢本月積分/排名/勝率
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth() + 1;
      const { data: scoreData, error: scoreError } = await supabase
        .from("member_monthly_score_summary")
        .select("*")
        .eq("team_id", user.team_id)
        .eq("name", user.name)
        .eq("year", year)
        .eq("month", month)
        .single();
      console.log('scoreData', scoreData);
      // 查詢歷史最佳紀錄
      const { data: bestData } = await supabase
        .from("member_monthly_score_summary")
        .select("points, rank")
        .eq("team_id", user.team_id)
        .eq("name", user.name)
        .order("points", { ascending: false })
        .limit(1);

      // 查詢所有單打比賽
      const { data: singleGames } = await supabase
        .from("g_single_game")
        .select("*")
        .eq("team_id", user.team_id)
        .or(`player1.eq.${user.name},player2.eq.${user.name}`)
        .order("record_date", { ascending: false });

      // 查詢所有雙打比賽
      const { data: doubleGames } = await supabase
        .from("g_double_game")
        .select("*")
        .eq("team_id", user.team_id)
        .or([
          `player1.eq.${user.name}`,
          `player2.eq.${user.name}`,
          `player3.eq.${user.name}`,
          `player4.eq.${user.name}`
        ].join(","))
        .order("record_date", { ascending: false });

      // 標註比賽類型與勝負
      const singleGamesWithResult = (singleGames || []).map(game => ({
        ...game,
        type: '單打',
        partner: '--',
        opponent: game.player1 === user.name ? game.player2 : game.player1,
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
          result: (game.win1_name === user.name || game.win2_name === user.name) ? '勝' : '負'
        };
      });

      // 合併、排序
      const allGames = [...singleGamesWithResult, ...doubleGamesWithResult]
        .sort((a, b) => new Date(b.record_date).getTime() - new Date(a.record_date).getTime());

      // 查詢已接受的挑戰
      const { data: challengeData, error: challengeError } = await supabase
        .from('challenges')
        .select('*, status_code, challenge_date, player1, player2, player3, player4, game_type, time_slot')
        .or([
          `player1.eq.${user.name}`,
          `player2.eq.${user.name}`,
          `player3.eq.${user.name}`,
          `player4.eq.${user.name}`
        ].join(","));
      let acceptedChs: any[] = [];
      if (challengeData && challengeData.length > 0) {
        // 查詢 status_log
        const statusCodes = challengeData.map((c: any) => c.status_code).filter(Boolean);
        let logsMap: Record<string, any> = {};
        if (statusCodes.length > 0) {
          const { data: logs } = await supabase
            .from('challenge_status_logs')
            .select('*')
            .in('status_code', statusCodes);
          if (logs) {
            logsMap = logs.reduce((acc: any, log: any) => {
              acc[log.status_code] = log;
              return acc;
            }, {} as Record<string, any>);
          }
        }
        acceptedChs = challengeData.filter((ch: any) => {
          let playerField = '';
          if (user.name === ch.player1) playerField = 'player1_status';
          else if (user.name === ch.player2) playerField = 'player2_status';
          else if (user.name === ch.player3) playerField = 'player3_status';
          else if (user.name === ch.player4) playerField = 'player4_status';
          else return false;
          const status = logsMap[ch.status_code]?.[playerField];
          return status === '已接受';
        });
        setAcceptedChallenges(acceptedChs);
        console.log('已接受的挑戰:', acceptedChs);
      }
      // 查詢已接受的比賽
      const { data: contestMemberData, error: contestMemberError } = await supabase
        .from('contest_team_member')
        .select('contest_id, contest_team_id, status, contest_team:contest_team_id(team_name), contest:contest_id(contest_name)')
        .eq('member_id', user.member_id)
        .eq('status', 'accepted');
      console.log('查詢 contest_team_member:', contestMemberData, contestMemberError);
      setAcceptedContests(contestMemberData || []);
      console.log('已接受的比賽:', contestMemberData);

      setStats({
        name: user.name,
        email: user.email,
        team_id: user.team_id,
        role: user.role,
        points: scoreData?.points ?? 0,
        rank: scoreData?.rank ?? 0,
        winning_rate: scoreData?.winning_rate,
        total_games: scoreData?.total_games,
        win_games: scoreData?.win_games,
        best_points: bestData?.[0]?.points,
        best_rank: bestData?.[0]?.rank,
      });
      setRecentGames(allGames);
      // 統計有資料的月份
      const months = Array.from(
        new Set(allGames.map(g => {
          const isoDate = g.record_date.includes('T')
            ? g.record_date
            : `${g.record_date.replace(' ', 'T')}Z`;
          const date = new Date(isoDate);
          return date.getUTCMonth() + 1;
        }))
      );
      setAvailableMonths(months);
      if (months.length > 0 && !months.includes(selectedMonth)) {
        setSelectedMonth(months[0]);
      }
      setLoading(false);
    };
    fetchPersonalInfo();
  }, [user]);

  if (loading) return <div>載入中...</div>;
  if (errorMsg) return <div className="text-red-600">{errorMsg}</div>;
  if (!stats) return null;

  // 根據選擇的月份篩選資料
  const filteredGames = recentGames.filter((g: any) => {
    const isoDate = g.record_date.includes('T')
      ? g.record_date
      : `${g.record_date.replace(' ', 'T')}Z`;
    const date = new Date(isoDate);
    return date.getUTCMonth() + 1 === selectedMonth;
  });
  // 只顯示前5筆
  const displayedGames = filteredGames.slice(0, 5);

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h2 className="text-2xl font-bold mb-4">個人資訊</h2>
      <div className="mb-4">
        <div><b>姓名：</b>{stats.name}</div>
        {stats.email && <div><b>Email：</b>{stats.email}</div>}
        <div><b>團隊：</b>{TEAM_NAMES[stats.team_id] || stats.team_id}</div>
        {stats.role && <div><b>身份：</b>{stats.role}</div>}
      </div>
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-blue-50 p-4 rounded">
          <div className="text-sm text-gray-500">本月積分</div>
          <div className="text-2xl font-bold">{stats.points}</div>
        </div>
        <div className="bg-green-50 p-4 rounded">
          <div className="text-sm text-gray-500">本月排名</div>
          <div className="text-2xl font-bold">{stats.rank > 0 ? `第${stats.rank}名` : '--'}</div>
        </div>
        <div className="bg-yellow-50 p-4 rounded">
          <div className="text-sm text-gray-500">本月勝率</div>
          <div className="text-2xl font-bold">
            {filteredGames.length > 0
              ? `${((filteredGames.filter(g => g.result === '勝').length / filteredGames.length) * 100).toFixed(1)}%`
              : '--'}
          </div>
        </div>
        <div className="bg-purple-50 p-4 rounded">
          <div className="text-sm text-gray-500">本月比賽/勝場</div>
          <div className="text-2xl font-bold">
            {filteredGames.length > 0
              ? `${filteredGames.length} / ${filteredGames.filter(g => g.result === '勝').length}`
              : '-- / --'}
          </div>
        </div>
      </div>
      <div className="mb-6">
        <div className="font-bold mb-2">歷史最佳紀錄</div>
        <div>最高積分：{stats.best_points ?? '--'}</div>
        <div>最佳排名：{stats.best_rank ? `第${stats.best_rank}名` : '--'}</div>
      </div>
      <h2 className="mt-8 mb-2 font-bold">對戰紀錄月份</h2>
      <div className="flex flex-col gap-1 mb-2">
        <div className="flex gap-2 justify-center">
          {[1,2,3,4,5,6].map(month => {
            const hasData = availableMonths.includes(month);
            const count = recentGames.filter(g => {
              const isoDate = g.record_date.includes('T')
                ? g.record_date
                : `${g.record_date.replace(' ', 'T')}Z`;
              const date = new Date(isoDate);
              return date.getUTCMonth() + 1 === month;
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
        <div className="flex gap-2 justify-center">
          {[7,8,9,10,11,12].map(month => {
            const hasData = availableMonths.includes(month);
            const count = recentGames.filter(g => {
              const isoDate = g.record_date.includes('T')
                ? g.record_date
                : `${g.record_date.replace(' ', 'T')}Z`;
              const date = new Date(isoDate);
              return date.getUTCMonth() + 1 === month;
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
      </div>
      <h2 className="mb-2 font-bold">{selectedMonth}月所有對戰</h2>
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
            {displayedGames.length === 0 ? (
              <tr><td colSpan={7}>無紀錄</td></tr>
            ) : (
              displayedGames.map((game: any, idx: number) => {
                const date = game.record_date ? new Date(game.record_date) : null;
                const dateStr = date ? `${date.getUTCMonth() + 1}/${date.getUTCDate()}` : '';
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
      <div className="mb-6">
        <div className="font-bold mb-2">已接受的挑戰</div>
        {acceptedChallenges.length === 0 ? (
          <div className="text-gray-500">無已接受的挑戰</div>
        ) : (
          <table className="min-w-full border text-center mb-2">
            <thead>
              <tr>
                <th className="border px-2">日期</th>
                <th className="border px-2">類型</th>
                <th className="border px-2">對手</th>
                <th className="border px-2">時段</th>
              </tr>
            </thead>
            <tbody>
              {acceptedChallenges.map((ch: any, idx: number) => (
                <tr key={ch.challenge_id || idx}>
                  <td className="border px-2">{ch.challenge_date ? ch.challenge_date.split('T')[0] : (ch.created_at ? ch.created_at.split('T')[0] : '')}</td>
                  <td className="border px-2">{ch.game_type === 'single' ? '單打' : '雙打'}</td>
                  <td className="border px-2">{[ch.player1, ch.player2, ch.player3, ch.player4].filter((n: any) => n && n !== user.name).join('、')}</td>
                  <td className="border px-2">{ch.time_slot}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="mb-6">
        <div className="font-bold mb-2">已接受的比賽</div>
        {acceptedContests.length === 0 ? (
          <div className="text-gray-500">無已接受的比賽</div>
        ) : (
          <table className="min-w-full border text-center mb-2">
            <thead>
              <tr>
                <th className="border px-2">比賽名稱</th>
                <th className="border px-2">隊伍名稱</th>
              </tr>
            </thead>
            <tbody>
              {acceptedContests.map((ct: any, idx: number) => (
                <tr key={ct.contest_id || idx}>
                  <td className="border px-2">{ct.contest?.contest_name || ct.contest_id}</td>
                  <td className="border px-2">{ct.contest_team?.team_name || ct.contest_team_id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default PersonalInfo;
