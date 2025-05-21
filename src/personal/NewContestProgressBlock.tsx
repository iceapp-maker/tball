import React, { useContext, useEffect, useState } from 'react';
import { UserContext } from '../UserContext';
import { supabase } from '../supabaseClient';
import { useNavigate } from 'react-router-dom';

interface ContestProgress {
  contest_id: number;
  contest_name: string;
  team_name: string;
  status: string;
  contest_status: string;
  team_member_status?: string;
  contest_team_id: string;
  players_per_team?: number;
  acceptedMembersCount: number;
  // 這裡可根據實際資料表擴充更多欄位
}

const NewContestProgressBlock: React.FC = () => {
  const { user } = useContext(UserContext) ?? { user: null };
  const [contests, setContests] = useState<ContestProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchContests = async () => {
      setLoading(true);
      if (!user?.member_id) {
        setContests([]);
        setLoading(false);
        return;
      }
      // 查詢目前登入者已加入的所有比賽隊伍，並取得比賽狀態
      const { data, error } = await supabase
        .from('contest_team_member')
        .select('contest_id, status, contest_team_id, contest_team:contest_team_id(team_name, team_member_status), contest:contest_id(contest_name, contest_status, players_per_team)')
        .eq('member_id', user.member_id);
      if (!error && data && Array.isArray(data)) {
        // 整理成顯示用陣列，並將 contest_status 轉為中文
        const statusMap: Record<string, string> = {
          recruiting: '招募中',
          ready: '待開賽',
          in_progress: '進行中',
          completed: '已結束',
          cancelled: '已取消',
        };
        
        // 獲取每個隊伍的成員數量
        const teamMembersPromises = data.map(async (row: any) => {
          if (row.status === 'captain' && row.contest_team_id) {
            const { data: teamMembers } = await supabase
              .from('contest_team_member')
              .select('status')
              .eq('contest_team_id', row.contest_team_id);
            
            return {
              contest_team_id: row.contest_team_id,
              acceptedMembersCount: teamMembers ? teamMembers.filter((m: any) => 
                m.status === 'accepted' || m.status === 'captain').length : 0
            };
          }
          return null;
        });
        
        const teamMembersData = await Promise.all(teamMembersPromises);
        const teamMembersMap = teamMembersData.reduce((acc: Record<string, number>, item) => {
          if (item) {
            acc[item.contest_team_id] = item.acceptedMembersCount;
          }
          return acc;
        }, {});
        
        const result = data.map((row: any) => ({
          contest_id: row.contest_id,
          contest_name: row.contest?.contest_name || '',
          team_name: row.contest_team?.team_name || '',
          status: row.status,
          contest_status: statusMap[row.contest?.contest_status] || row.contest?.contest_status || '',
          team_member_status: row.contest_team?.team_member_status,
          contest_team_id: row.contest_team_id,
          players_per_team: row.contest?.players_per_team,
          acceptedMembersCount: teamMembersMap[row.contest_team_id] || 0
        }));
        setContests(result);
      } else {
        setContests([]);
      }
      setLoading(false);
    };
    fetchContests();
  }, [user?.member_id]);

  // 導航到比賽頁面的函數
  const navigateToContestJoinPage = (contestId: number) => {
    navigate(`/contest/${contestId}/join`);
  };

  return (
    <div className="mb-6 p-4 bg-blue-50 rounded shadow">
      <h3 className="font-bold mb-2 text-lg">已報名比賽進度</h3>
      {loading ? (
        <div>載入中...</div>
      ) : contests.length === 0 ? (
        <div className="text-gray-500">目前尚未加入任何比賽</div>
      ) : (
        <ul className="list-disc pl-6">
          {contests.map((c, idx) => (
            <li key={c.contest_id + '-' + idx}>
              <b>{c.contest_name}</b>｜隊伍：{c.team_name}｜狀態：{c.status}｜比賽狀態：{c.contest_status}
              {c.status === 'captain' && c.team_member_status !== 'done' && 
               c.acceptedMembersCount >= (c.players_per_team || 0) && (
                <button 
                  onClick={() => navigateToContestJoinPage(c.contest_id)}
                  className="text-orange-500 ml-2 font-medium hover:underline cursor-pointer"
                >
                  ! 隊伍人數已足夠，請前往比賽頁面確認「人員已到位」
                </button>
              )}
              {c.status === 'captain' && c.team_member_status === 'done' && (
                <span className="text-green-600 ml-2 font-medium">✓ 已確認人員到位</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
export default NewContestProgressBlock;