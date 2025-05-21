import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';

const ContestControlPage: React.FC = () => {
  const navigate = useNavigate();
  const [contests, setContests] = useState<any[]>([]);
  const [teamCounts, setTeamCounts] = useState<{[key: string]: number}>({});
  const [contestsWithScores, setContestsWithScores] = useState<{[key: string]: boolean}>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [generatingSchedule, setGeneratingSchedule] = useState(false);
  const [generatingContestId, setGeneratingContestId] = useState<string | null>(null);

  // 假設有user context
  const user = JSON.parse(localStorage.getItem('loginUser') || '{}');

  useEffect(() => {
    fetchContests();
  }, []);

  interface ContestMatch {
    score: string | null;
  }

  const checkAllScoresFilled = async (contestId: string) => {
    try {
      const { data: matches, error } = await supabase
        .from('contest_match')
        .select('score')
        .eq('contest_id', contestId);

      if (error) throw error;
      
      return matches && matches.length > 0 && matches.every(
        (match: ContestMatch) => match.score !== null && match.score !== undefined && match.score !== ''
      );
    } catch (err) {
      console.error('檢查比分時出錯:', err);
      return false;
    }
  };

  const handleFinishContest = async (contestId: string) => {
    try {
      const { error } = await supabase
        .from('contest')
        .update({ contest_status: 'finished' })
        .eq('contest_id', contestId);

      if (error) throw error;

      setContests(contests.map((contest: { contest_id: string, contest_status: string }) => 
        contest.contest_id === contestId 
          ? { ...contest, contest_status: 'finished' } 
          : contest
      ));
      alert('比賽已成功結束！');
    } catch (err) {
      console.error('更新比賽狀態時出錯:', err);
      alert('更新比賽狀態失敗，請稍後再試！');
    }
  };

  const fetchContests = async () => {
    setLoading(true);
    try {
      // 獲取比賽資料
      const { data: contestsData, error: contestsError } = await supabase
        .from('contest')
        .select('*')
        .order('contest_id', { ascending: false });

      if (contestsError) throw contestsError;
      setContests(contestsData || []);
      console.log('[fetchContests] contestsData', contestsData);

      // 獲取每個比賽的隊伍數量
      const counts: {[key: string]: number} = {};
      for (const contest of contestsData || []) {
        const { count, error: countError, data: teamData } = await supabase
          .from('contest_team')
          .select('contest_team_id', { count: 'exact' })
          .eq('contest_id', contest.contest_id);

        if (countError) throw countError;
        counts[contest.contest_id] = count || 0;
        console.log(`[fetchContests] contest_id=${contest.contest_id} 查到隊伍數:`, count, '隊伍資料:', teamData);
      }
      setTeamCounts(counts);
      console.log('[fetchContests] counts 統計結果', counts);

      // 檢查每個進行中比賽的比分填寫狀態
      const scoresStatus: {[key: string]: boolean} = {};
      for (const contest of contestsData || []) {
        if (contest.contest_status === 'ongoing') {
          scoresStatus[contest.contest_id] = await checkAllScoresFilled(contest.contest_id);
        }
      }
      setContestsWithScores(scoresStatus);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // 產生對戰表（循環賽）
  const handleGenerateSchedule = async (contestId: string) => {
    if (!confirm('確定要產生對戰表嗎？產生後將無法更改隊伍名單。')) {
      return;
    }

    setGeneratingSchedule(true);
    setGeneratingContestId(contestId);

    try {
      // 1. 獲取比賽資訊
      const { data: contestData } = await supabase
        .from('contest')
        .select('*')
        .eq('contest_id', contestId)
        .single();

      if (!contestData) throw new Error('找不到比賽資訊');

      // 2. 獲取所有參賽隊伍
      const { data: teamsData } = await supabase
        .from('contest_team')
        .select('*')
        .eq('contest_id', contestId);

      if (!teamsData || teamsData.length < 2) {
        throw new Error('參賽隊伍不足，至少需要2支隊伍');
      }

      // 3. 產生循環賽對戰組合
      const matches = generateRoundRobinMatches(teamsData, contestData.table_count || 1);

      // 4. 將對戰組合寫入資料庫
      const { data: matchesData, error: matchesError } = await supabase
        .from('contest_match')
        .insert(matches)
        .select(); // 添加 select() 確保返回插入後的完整資料，包含 match_id

      if (matchesError) throw matchesError;

      // 5. 為每場比賽產生對戰詳情（每點）
      if (matchesData) {
        for (const match of matchesData) {
          // 為每場比賽的每個點位創建詳情記錄
          for (let i = 0; i < contestData.total_points; i++) {
            const matchDetail = {
              // match_detail_id 是 serial，由資料庫自動生成
              match_id: match.match_id,
              contest_id: contestData.contest_id, // 添加必要的 contest_id 欄位
              team1_member_ids: [], // 直接傳遞陣列，Supabase 會自動處理 jsonb 類型
              team2_member_ids: [], // 直接傳遞陣列，Supabase 會自動處理 jsonb 類型
              winner_team_id: null,
              score: null,
              sequence: i + 1,
              match_type: contestData.points_config && contestData.points_config[i] 
                ? contestData.points_config[i].type 
                : '雙打',
              table_no: null, // 使用正確的欄位名稱，替換 played_at
              judge_id: null // 只保留 SQL 定義中存在的欄位
            };

            const { error: detailError } = await supabase
              .from('contest_match_detail')
              .insert([matchDetail]);

            if (detailError) {
              console.error('新增比賽詳情失敗:', detailError, matchDetail);
              // 繼續處理其他記錄，不中斷流程
            }
          }
        }
      }

     // 7. 確保比賽狀態保持為「名單安排中」
await supabase
  .from('contest')
  .update({ contest_status: 'lineup_arrangement' })
  .eq('contest_id', contestId);

      alert('對戰表產生成功！');
      fetchContests(); // 重新載入比賽列表
    } catch (err: any) {
      console.error('產生對戰表失敗:', err);
      alert(`產生對戰表失敗: ${err.message}`);
    } finally {
      setGeneratingSchedule(false);
      setGeneratingContestId(null);
    }
  };

  // 產生循環賽對戰組合的函數
  const generateRoundRobinMatches = (teams: any[], tableCount: number) => {
    const matches = [];
    let tableNo = 1;
    let sequence = 1;
    
    for (let i = 0; i < teams.length; i++) {
      for (let j = i + 1; j < teams.length; j++) {
        // 修改為使用 contest_team_id
        const team1Id = typeof teams[i].contest_team_id === 'string' ? parseInt(teams[i].contest_team_id) : teams[i].contest_team_id;
        const team2Id = typeof teams[j].contest_team_id === 'string' ? parseInt(teams[j].contest_team_id) : teams[j].contest_team_id;
        const contestId = typeof teams[i].contest_id === 'string' ? parseInt(teams[i].contest_id) : teams[i].contest_id;
        
        matches.push({
          // match_id 是 serial，由資料庫自動生成
          contest_id: contestId,
          team1_id: team1Id,
          team2_id: team2Id,
          winner_team_id: null,
          match_date: new Date().toISOString().split('T')[0], // 轉換為 date 類型
          score: null,
          sequence: sequence // 添加 sequence 欄位
        });
        
        // 遞增序列號
        sequence++;
        
        // 循環分配桌次
        tableNo++;
        if (tableNo > tableCount) tableNo = 1;
      }
    }
    return matches;
  };

  // 渲染比賽狀態標籤
  const renderStatusBadge = (status: string) => {
    let color = '';
    let text = '';
    
    switch (status) {
      case 'recruiting':
        color = 'bg-blue-500';
        // 檢查是否達到預期隊伍數
        const contest = contests.find((c: { contest_status: string, contest_id: string, expected_teams: number }) => c.contest_status === status);
        const teamCount = contest ? teamCounts[contest.contest_id] || 0 : 0;
        const expectedTeams = contest ? contest.expected_teams : 0;
        
        if (teamCount === expectedTeams) {
          text = '人員招募完成';
        } else {
          text = '人員招募中';
        }
        break;
      case 'lineup_arrangement':
        color = 'bg-yellow-500';
        text = '名單安排中';
        break;
      case 'ongoing':
        color = 'bg-green-500';
        text = '比賽進行中';
        break;
      case 'finished':
        color = 'bg-gray-500';
        text = '比賽已結束';
        break;
      default:
        color = 'bg-gray-400';
        text = status;
    }
    
    return (
      <span className={`${color} text-white px-2 py-1 rounded text-xs`}>
        {text}
      </span>
    );
  };

  return (
    <div className="max-w-6xl mx-auto mt-8 p-6 bg-white rounded shadow">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">賽程控制區</h2>
        <Link to="/contest/create">
          <button className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded">
            建立比賽
          </button>
        </Link>
      </div>

      {loading ? (
        <div className="text-center py-8">載入中...</div>
      ) : error ? (
        <div className="text-red-500 text-center py-8">{error}</div>
      ) : contests.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          目前沒有比賽，請點擊「建立比賽」按鈕創建新比賽。
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full bg-white border">
            <thead className="bg-gray-100">
              <tr>
                <th className="py-2 px-4 border text-left">比賽名稱</th>
                <th className="py-2 px-4 border text-left">狀態</th>
                
                
                <th className="py-2 px-4 border text-left">報名截止日</th>
                
                <th className="py-2 px-4 border text-left sticky right-0 bg-gray-100 shadow-md z-10">操作</th>
              </tr>
            </thead>
            <tbody>
              {contests.map((contest) => (
                <tr key={contest.contest_id} className="hover:bg-gray-50">
                  <td className="py-3 px-4 border">
  {contest.contest_name}
</td>
                  <td className="py-3 px-4 border">{renderStatusBadge(contest.contest_status)}</td>
                  
                  
                  <td className="py-3 px-4 border">{(() => { const d = new Date(contest.signup_end_date); return `${d.getMonth() + 1}/${d.getDate()}`; })()}</td>
                  
                  <td className="py-3 px-4 border sticky right-0 bg-white shadow-md z-10">
                    <div className="flex space-x-2">
                      <button
                        className="bg-blue-500 hover:bg-blue-600 text-white px-2 py-1 rounded text-sm"
                        onClick={() => navigate(`/contest/edit/${contest.contest_id}`)}
                      >
                        編輯
                      </button>

{contest.contest_status === 'recruiting' && 
                        teamCounts[contest.contest_id] === contest.expected_teams && (
                        <button
                          className="bg-red-500 hover:bg-red-600 text-white px-2 py-1 rounded text-sm"
                          onClick={() => handleGenerateSchedule(contest.contest_id)}
                          disabled={generatingSchedule && generatingContestId === contest.contest_id}
                        >
                          {generatingSchedule && generatingContestId === contest.contest_id 
                            ? '產生中...' 
                            : '產生對戰表'}
                        </button>
                      )}

                      <button
                        onClick={() => {
                          if (contest.contest_status === 'finished') {
                            navigate(`/contest/${contest.contest_id}/results`);
                          } else if (contest.contest_status === 'ongoing') {
                            navigate(`/contest/${contest.contest_id}/battleroom`);
                          } else if (contest.contest_status === 'recruiting') {
                            navigate(`/contest/${contest.contest_id}/join`);
                          } else if (contest.contest_status === 'lineup_arrangement') {
                            navigate(`/contest/${contest.contest_id}/lineup-status`);
                          }
                        }}
                        className="bg-blue-500 hover:bg-blue-600 text-white px-2 py-1 rounded text-sm"
                      >
                        {contest.contest_status === 'finished' 
                          ? '查看結果' 
                          : contest.contest_status === 'ongoing'
                            ? '查看賽程'
                            : contest.contest_status === 'recruiting'
                              ? '查看報名'
                              : '查看名單'}
                      </button>

                      {contest.contest_status === 'ongoing' && contestsWithScores[contest.contest_id] && (
                        <button
                          onClick={() => handleFinishContest(contest.contest_id)}
                          className="bg-green-600 hover:bg-green-700 text-white px-2 py-1 rounded text-sm"
                        >
                          確認比賽結束
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      
      <div className="mt-6 p-4 bg-yellow-50 border border-yellow-200 rounded">
        <h3 className="font-bold text-yellow-800 mb-2">說明</h3>
        <ul className="list-disc pl-5 text-sm text-yellow-700">
          <li>當比賽狀態為「名單安排中」時，可以產生對戰表。</li>
          <li>循環賽：每隊都會與其他所有隊伍對戰一次。</li>
          <li>產生對戰表後，比賽狀態將更新為「比賽進行中」。</li>
          <li>產生對戰表後，將由隊長編排出賽名單。</li>
        </ul>
      </div>
    </div>
  );
};

export default ContestControlPage;