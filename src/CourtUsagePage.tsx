// CourtUsagePage.tsx
import React, { useEffect, useState, useContext } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { supabase } from './supabaseClient';
import { useNavigate } from 'react-router-dom'; // 添加導入
import { UserContext } from './UserContext';

const CourtUsagePage: React.FC = () => {
  const user = useContext(UserContext); // 直接使用 UserContext
  const navigate = useNavigate(); // 用於導航回首頁
  const [stats, setStats] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [courtName, setCourtName] = useState<string>('');
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth() + 1);
  const [monthsWithData, setMonthsWithData] = useState<number[]>([]);

  const now = new Date();
  const currentYear = now.getFullYear();
  const startOfMonth = new Date(currentYear, selectedMonth - 1, 1);
  const endOfMonth = new Date(currentYear, selectedMonth, 0, 23, 59, 59, 999);

  // 取得有資料的月份
  useEffect(() => {
    const fetchMonths = async () => {
      let teamId = user && user.team_id ? user.team_id : 'T';
      let { data, error } = await supabase
        .from('member_stats')
        .select('game_record_date')
        .eq('team_id', teamId);
      if (!error && data) {
        const months = Array.from(new Set(
          data
            .filter((item: any) => !!item.game_record_date)
            .map((item: any) => new Date(item.game_record_date).getMonth() + 1)
        ));
        setMonthsWithData(months);
      }
    };
    fetchMonths();
  }, [user]);

  useEffect(() => {
    const fetchStats = async () => {
      setLoading(true);
      setError(null);
      let teamId = user && user.team_id ? user.team_id : 'T';
      // 1. 查詢場地名稱
      let courtRes = await supabase
        .from('courts')
        .select('name')
        .eq('team_id', teamId)
        .limit(1);
      if (courtRes.error) {
        setError('查詢場地名稱失敗: ' + courtRes.error.message);
        setLoading(false);
        return;
      }
      if (courtRes.data && courtRes.data.length > 0) {
        setCourtName(courtRes.data[0].name);
      } else {
        setCourtName('(查無場地名稱)');
      }
      // 2. 查詢所選月份的使用紀錄
      let query = supabase.from('member_stats').select('game_record_date,team_id');
      query = query.eq('team_id', teamId)
        .gte('game_record_date', startOfMonth.toISOString())
        .lte('game_record_date', endOfMonth.toISOString());
      const { data, error } = await query;
      if (!error && data) setStats(data);
      else setError(error ? error.message : '查詢失敗');
      setLoading(false);
    };
    fetchStats();
  }, [user, selectedMonth]);

  // 統計每小時場次，僅顯示有資料的小時，並依小時排序
  const hourCount: { [hour: number]: number } = {};
  stats.forEach(item => {
    if (item.game_record_date) {
      const h = new Date(item.game_record_date).getHours();
      hourCount[h] = (hourCount[h] || 0) + 1;
    }
  });
  const hourData = Object.entries(hourCount)
    .map(([hour, count]) => ({ hour: `${hour}:00`, count }))
    .sort((a, b) => parseInt(a.hour) - parseInt(b.hour));

  // 產生 1~12 月份按鈕
  const monthButtons = Array.from({ length: 12 }, (_, i) => i + 1).map(month => (
    <button
      key={month}
      className={`px-3 py-1 m-1 rounded border transition-all ${selectedMonth === month
        ? 'bg-blue-600 text-white border-blue-800'
        : monthsWithData.includes(month)
          ? 'bg-white text-blue-700 border-blue-400 font-bold'
          : 'bg-gray-200 text-gray-400 border-gray-300'}`}
      onClick={() => setSelectedMonth(month)}
      disabled={!monthsWithData.includes(month)}
      style={{ cursor: monthsWithData.includes(month) ? 'pointer' : 'not-allowed' }}
    >
      {month}月
    </button>
  ));

  return (
    <div className="max-w-2xl mx-auto mt-8 p-4 bg-white rounded shadow">
      <h1 className="text-2xl font-bold mb-4">球場時段使用分佈</h1>
      {courtName && (
        <div className="mb-2 text-lg text-gray-700 font-semibold">場地名稱：{courtName}</div>
      )}
      <div className="mb-4 flex flex-wrap items-center">{monthButtons}</div>
      <button 
        className="mb-4 px-4 py-2 bg-blue-500 text-white rounded"
        onClick={() => navigate('/')}
      >
        返回主選單
      </button>
      {error ? (
        <div className="text-red-500">錯誤: {error}</div>
      ) : loading ? (
        <div>載入中...</div>
      ) : stats.length === 0 ? (
        <div>沒有可用的資料</div>
      ) : (
        <ResponsiveContainer width="100%" height={350}>
          <BarChart data={hourData}>
            <XAxis dataKey="hour" />
            <YAxis allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="count" fill="#8884d8" />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
};

export default CourtUsagePage;