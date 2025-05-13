import React, { useContext, useEffect, useState } from 'react';
import { UserContext } from '../UserContext';
import { supabase } from '../supabaseClient';

interface PersonalStats {
  points: number;
  rank: number;
  winning_rate?: number;
  total_games: number;
  win_games?: number;
  best_points?: number;
  best_rank?: number;
}

const NewStatsBlock: React.FC = () => {
  const { user } = useContext(UserContext) ?? { user: null };
  const [stats, setStats] = useState<PersonalStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const fetchStats = async () => {
      setLoading(true);
      setErrorMsg(null);
      if (!user) {
        setErrorMsg("請先登入");
        setLoading(false);
        return;
      }

      // 檢查 user 物件內容，找出正確的 UUID
      console.log("User object:", user);

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
        .eq("month", month);

      if (scoreError) {
        setErrorMsg("查詢本月成績失敗: " + scoreError.message);
        setLoading(false);
        return;
      }

      // 查詢累計績分（所有月份總分）
      // 首先需要查詢 members 資料表，找出 member_id 對應的 UUID (id)
      const { data: memberData, error: memberError } = await supabase
        .from("members")
        .select("id")
        .eq("member_id", user.member_id)
        .maybeSingle();
        
      console.log("會員資料:", memberData, "錯誤:", memberError);
      
      if (memberError || !memberData || !memberData.id) {
        console.error("找不到會員 UUID:", memberError || "無資料");
        setErrorMsg("無法取得用戶 ID");
        setLoading(false);
        return;
      }
      
      // 使用找到的 UUID 查詢積分
      const memberUuid = memberData.id;
      console.log("找到的會員 UUID:", memberUuid);
      
      const { data: sumPointsData, error: sumPointsError } = await supabase
        .from("member_monthly_score_summary")
        .select("points")
        .eq("member_id", memberUuid);
      
      console.log("查詢結果:", sumPointsData, "錯誤:", sumPointsError);

      let sumPoints = 0;
      if (sumPointsData && Array.isArray(sumPointsData)) {
        sumPoints = sumPointsData.reduce((acc, cur) => acc + (cur.points || 0), 0);
      }

      // 查詢歷史最佳排名
      const { data: bestRankData } = await supabase
        .from("member_monthly_score_summary")
        .select("rank")
        .eq("team_id", user.team_id)
        .eq("name", user.name)
        .order("rank", { ascending: true })
        .limit(1);

      // 如果本月沒有成績，使用預設值
      const currentMonthData = scoreData && scoreData.length > 0 ? scoreData[0] : null;

      setStats({
        points: currentMonthData?.points ?? 0,
        rank: currentMonthData?.rank ?? 0,
        winning_rate: currentMonthData?.winning_rate,
        total_games: currentMonthData?.total_games ?? 0,
        win_games: currentMonthData?.win_games,
        best_points: sumPoints, // 將歷史最高積分改為累計績分
        best_rank: bestRankData?.[0]?.rank,
      });
      setLoading(false);
    };

    fetchStats();
  }, [user]);

  if (loading) return <div className="mb-6 p-4 bg-purple-50 rounded shadow">載入中...</div>;
  if (errorMsg) return <div className="mb-6 p-4 bg-red-50 rounded shadow text-red-600">{errorMsg}</div>;
  if (!stats) return null;

  return (
    <div className="mb-6 p-4 bg-purple-50 rounded shadow">
      <h3 className="font-bold mb-4 text-lg">本月/近期成績統計</h3>
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white p-3 rounded shadow-sm">
          <div className="text-sm text-gray-500">本月積分</div>
          <div className="text-2xl font-bold">{stats.points}</div>
        </div>
        <div className="bg-white p-3 rounded shadow-sm">
          <div className="text-sm text-gray-500">本月排名</div>
          <div className="text-2xl font-bold">{stats.rank > 0 ? `第${stats.rank}名` : '--'}</div>
        </div>
        <div className="bg-white p-3 rounded shadow-sm">
          <div className="text-sm text-gray-500">本月勝率</div>
          <div className="text-2xl font-bold">
            {stats.winning_rate
              ? (() => {
                  const num = Number(String(stats.winning_rate).replace('%', ''));
                  return isNaN(num) ? '--' : `${num.toFixed(1)}%`;
                })()
              : '--'}
          </div>
        </div>
        <div className="bg-white p-3 rounded shadow-sm">
          <div className="text-sm text-gray-500">比賽/勝場</div>
          <div className="text-2xl font-bold">
            {stats.total_games > 0 ? `${stats.total_games} / ${stats.win_games ?? 0}` : '-- / --'}
          </div>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4">
        <div className="bg-white p-3 rounded shadow-sm">
          <div className="text-sm text-gray-500">累計績分</div>
          <div className="text-2xl font-bold">{stats.best_points ?? 0}</div>
        </div>
        <div className="bg-white p-3 rounded shadow-sm">
          <div className="text-sm text-gray-500">最佳排名</div>
          <div className="text-xl font-bold">{stats.best_rank ? `第${stats.best_rank}名` : '--'}</div>
        </div>
      </div>
    </div>
  );
};

export default NewStatsBlock; 