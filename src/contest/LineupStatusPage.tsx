import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';

interface LineupStatus {
  team1_name: string;
  team2_name: string;
}

const LineupStatusPage: React.FC = () => {
  const { contestId } = useParams<{ contestId: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lineups, setLineups] = useState<LineupStatus[]>([]);
  const [contestName, setContestName] = useState('');

  useEffect(() => {
    if (contestId) {
      fetchContestName();
      fetchLineupStatus();
    }
    // eslint-disable-next-line
  }, [contestId]);

  // 取得比賽名稱
  const fetchContestName = async () => {
    try {
      const { data, error } = await supabase
        .from('contest')
        .select('contest_name')
        .eq('contest_id', contestId)
        .single();
      if (error) throw error;
      setContestName(data?.contest_name || '');
    } catch {
      setContestName('');
    }
  };

  // 取得名單狀態
  const fetchLineupStatus = async () => {
    setLoading(true);
    setError('');
    try {
      const { data, error } = await supabase
        .from('vw_lineupstatuspage')
        .select('team1_name, team2_name')
        .eq('contest_id', contestId);
      if (error) throw error;
      setLineups(data || []);
    } catch (err: any) {
      setError('載入資料失敗');
    } finally {
      setLoading(false);
    }
  };

  const goBackToContest = () => {
    window.history.back();
  };

  // 解析隊伍名稱與狀態，換行顯示
  const renderTeamCell = (team: string) => {
  const isUnarranged = team.includes('未編排');
  return (
    <span className={`font-extrabold text-xl ${isUnarranged ? 'text-red-600' : 'text-green-700'}`}>{team}</span>
  );
};

  return (
    <div className="max-w-3xl mx-auto p-6 bg-gradient-to-br from-blue-50 to-white min-h-screen rounded-xl shadow-xl">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-blue-900">
          {contestName ? `${contestName} 名單狀態` : '名單狀態'}
        </h1>
        <button
          onClick={goBackToContest}
          className="px-5 py-2 bg-blue-100 text-blue-800 rounded-lg shadow-sm hover:bg-blue-200 transition font-semibold text-base"
        >
          返回比賽
        </button>
      </div>

      {loading && <div className="text-center py-10 text-lg text-blue-700">載入中...</div>}
      {!loading && error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4 text-lg">
          {error}
        </div>
      )}
      {!loading && !error && lineups.length === 0 && (
        <div className="text-center py-10 text-gray-500 text-lg">沒有資料</div>
      )}
      {!loading && !error && lineups.length > 0 && (
        <div className="bg-white shadow-lg rounded-2xl overflow-hidden border border-blue-100">
          <table className="min-w-full">
            <thead className="bg-blue-50">
              <tr>
                <th className="px-8 py-5 text-left text-xl font-bold text-blue-900 tracking-wider">隊伍1</th>
                <th className="px-4 py-5 text-center text-xl font-bold text-blue-900 tracking-wider">VS</th>
                <th className="px-8 py-5 text-left text-xl font-bold text-blue-900 tracking-wider">隊伍2</th>
              </tr>
            </thead>
            <tbody>
              {lineups.map((item, idx) => (
                <tr key={idx} className="hover:bg-blue-50 transition">
                  <td className="px-8 py-6 align-top border-b border-blue-100">{renderTeamCell(item.team1_name)}</td>
                  <td className="px-4 py-6 text-center text-2xl font-extrabold text-blue-700 border-b border-blue-100">VS</td>
                  <td className="px-8 py-6 align-top border-b border-blue-100">{renderTeamCell(item.team2_name)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default LineupStatusPage;
