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

  // 獲取登入使用者資訊
  const user = JSON.parse(localStorage.getItem('loginUser') || '{}');
  const currentUserTeamId = user.team_id;
  const currentUserTeamName = user.team_name; // 從登入者資訊中取得團隊名稱

  useEffect(() => {
    // 檢查是否有登入使用者和團隊資訊
    if (!user || !currentUserTeamId || !currentUserTeamName) {
      setError('請先登入並確認您有團隊權限');
      setLoading(false);
      return;
    }
    fetchContests();
  }, [currentUserTeamId, currentUserTeamName]);

  interface ContestMatch {
    score: string | null;
  }

  interface ContestMatchDetail {
    score: string | null;
  }

  const checkAllScoresFilled = async (contestId: string) => {
    try {
      const { data: matchDetails, error } = await supabase
        .from('contest_match_detail')  // 改為檢查 contest_match_detail 資料表
        .select('score')               // 選取 score 欄位
        .eq('contest_id', contestId);  // 篩選指定的比賽 ID

      if (error) throw error;
      
      // 檢查每一點的比分是否都已填入 (格式：a:b，其中a、b為數字)
      return matchDetails && matchDetails.length > 0 && matchDetails.every(
        (detail: ContestMatchDetail) => {
          // 檢查 score 是否存在且不為空
          if (!detail.score || detail.score.trim() === '') {
            return false;
          }
          
          // 檢查是否符合 a:b 格式 (a、b為數字)
          const scorePattern = /^\d+:\d+$/;
          return scorePattern.test(detail.score.trim());
        }
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
      // 只獲取當前團隊主辦的比賽資料
      // 使用 team_name 欄位與登入者的團隊名稱比對
      const { data: contestsData, error: contestsError } = await supabase
        .from('contest')
        .select('*')
        .eq('team_name', currentUserTeamName)  // 只取得當前團隊主辦的比賽
        .order('contest_id', { ascending: false });

      if (contestsError) {
        console.error('獲取比賽資料失敗:', contestsError);
        throw contestsError;
      }

      setContests(contestsData || []);
      console.log('[fetchContests] 當前團隊比賽資料:', contestsData);
      console.log('[fetchContests] 當前使用者團隊名稱:', currentUserTeamName);
      console.log('[fetchContests] 篩選條件: team_name =', currentUserTeamName);

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
      console.error('載入比賽資料時發生錯誤:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // 產生對戰表
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

      // 3. 根據賽制類型產生對戰組合
      let matches;
      if (contestData.match_mode === 'round_robin') {
        matches = generateImprovedRoundRobinMatches(teamsData, contestData.table_count || 1);
      } else if (contestData.match_mode === 'elimination') {
        matches = generateEliminationMatches(teamsData, contestData.table_count || 1);
      } else {
        matches = generateImprovedRoundRobinMatches(teamsData, contestData.table_count || 1);
      }

      // 4. 將對戰組合寫入資料庫
      const { data: matchesData, error: matchesError } = await supabase
        .from('contest_match')
        .insert(matches)
        .select();

      if (matchesError) throw matchesError;

      // 5. 為每場比賽產生對戰詳情
      if (matchesData) {
        for (const match of matchesData) {
          for (let i = 0; i < contestData.total_points; i++) {
            const matchDetail = {
              match_id: match.match_id,
              contest_id: contestData.contest_id,
              team1_member_ids: [],
              team2_member_ids: [],
              winner_team_id: null,
              score: null,
              sequence: i + 1,
              match_type: contestData.points_config && contestData.points_config[i] 
                ? contestData.points_config[i].type 
                : '雙打',
              table_no: null,
              judge_id: null
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

      // 🎯 簡易成功判定：檢查 contest_match 是否有該 contest_id 的資料
      const { data: verifyData, error: verifyError } = await supabase
        .from('contest_match')
        .select('contest_id')
        .eq('contest_id', contestId)
        .limit(1);

      if (verifyError) throw verifyError;

      // ✅ 如果找到資料，表示成功
      if (verifyData && verifyData.length > 0) {
        // 6. 更新比賽狀態為「人員安排中」
        const { error: updateError } = await supabase
          .from('contest')
          .update({ contest_status: 'lineup_arrangement' })
          .eq('contest_id', contestId);

        if (updateError) throw updateError;

        alert('對戰表產生成功！');
        fetchContests(); // 重新載入比賽列表
      } else {
        throw new Error('對戰表資料未成功寫入');
      }

    } catch (err: any) {
      console.error('產生對戰表失敗:', err);
      alert(`產生對戰表失敗: ${err.message}`);
    } finally {
      setGeneratingSchedule(false);
      setGeneratingContestId(null);
    }
  };

  // 改進的循環賽對戰生成函數 - 確保比賽分配更均勻
  const generateImprovedRoundRobinMatches = (teams: any[], tableCount: number) => {
    const matches = [];
    let sequence = 1;
    
    // 創建所有可能的對戰組合
    const allPairs = [];
    for (let i = 0; i < teams.length; i++) {
      for (let j = i + 1; j < teams.length; j++) {
        // 確保 ID 是數字類型
        const team1Id = typeof teams[i].contest_team_id === 'string' ? parseInt(teams[i].contest_team_id) : teams[i].contest_team_id;
        const team2Id = typeof teams[j].contest_team_id === 'string' ? parseInt(teams[j].contest_team_id) : teams[j].contest_team_id;
        const contestId = typeof teams[i].contest_id === 'string' ? parseInt(teams[i].contest_id) : teams[i].contest_id;
        
        allPairs.push({
          team1Id: team1Id,
          team2Id: team2Id,
          contestId: contestId
        });
      }
    }
    
    // 計算總輪次數量：n隊總共需要 n-1 輪（如果n為奇數，則每輪有一隊輪空）
    const totalRounds = teams.length % 2 === 0 ? teams.length - 1 : teams.length;
    
    // 每輪比賽數量：n/2 向下取整
    const matchesPerRound = Math.floor(teams.length / 2);
    
    // 建立每支隊伍的比賽追蹤
    const teamMatches: {[key: number]: number[]} = {};
    teams.forEach(team => {
      const teamId = typeof team.contest_team_id === 'string' ? parseInt(team.contest_team_id) : team.contest_team_id;
      teamMatches[teamId] = [];
    });
    
    // 建立輪次陣列
    const rounds: any[][] = Array(totalRounds).fill(null).map(() => []);
    
    // 嘗試為每輪分配比賽
    let currentRound = 0;
    
    // 複製一份對戰組合以便操作
    const remainingPairs = [...allPairs];
    
    // 為每輪分配比賽
    while (remainingPairs.length > 0) {
      const roundTeams = new Set(); // 追蹤本輪已安排的隊伍
      
      // 尋找本輪可安排的比賽
      for (let i = 0; i < remainingPairs.length; i++) {
        const pair = remainingPairs[i];
        
        // 檢查兩隊是否已在本輪安排比賽
        if (!roundTeams.has(pair.team1Id) && !roundTeams.has(pair.team2Id)) {
          // 將比賽添加到當前輪次
          rounds[currentRound].push(pair);
          
          // 標記這兩隊在本輪已安排比賽
          roundTeams.add(pair.team1Id);
          roundTeams.add(pair.team2Id);
          
          // 更新兩隊的比賽紀錄
          teamMatches[pair.team1Id].push(currentRound);
          teamMatches[pair.team2Id].push(currentRound);
          
          // 從未分配列表中移除
          remainingPairs.splice(i, 1);
          i--; // 因為移除了一個元素，所以索引需要減1
        }
      }
      
      // 進入下一輪
      currentRound = (currentRound + 1) % totalRounds;
      
      // 如果所有輪次都嘗試過，但仍有未分配的比賽，說明存在無法完美分配的情況
      // 這時採用貪婪算法，找出對當前輪次影響最小的比賽
      if (remainingPairs.length > 0 && rounds.every(round => round.length >= matchesPerRound)) {
        // 找出影響最小的一場比賽加入
        let bestPairIndex = 0;
        let minImpact = Infinity;
        
        for (let i = 0; i < remainingPairs.length; i++) {
          const pair = remainingPairs[i];
          
          // 計算將這場比賽添加到各輪的影響
          for (let r = 0; r < totalRounds; r++) {
            // 檢查該輪次兩隊是否已有比賽
            const team1HasMatch = teamMatches[pair.team1Id].includes(r);
            const team2HasMatch = teamMatches[pair.team2Id].includes(r);
            
            // 如果兩隊都沒有比賽，這是最理想的情況
            if (!team1HasMatch && !team2HasMatch) {
              // 添加這場比賽到當前輪次
              rounds[r].push(pair);
              teamMatches[pair.team1Id].push(r);
              teamMatches[pair.team2Id].push(r);
              remainingPairs.splice(i, 1);
              minImpact = -1; // 設置一個標記，表示找到理想解
              break;
            }
          }
          
          // 如果找到理想解，退出循環
          if (minImpact === -1) break;
          
          // 如果沒有理想解，找出影響最小的輪次
          for (let r = 0; r < totalRounds; r++) {
            // 計算影響值（已有比賽的隊伍數）
            let impact = (teamMatches[pair.team1Id].includes(r) ? 1 : 0) + 
                        (teamMatches[pair.team2Id].includes(r) ? 1 : 0);
            
            // 如果影響更小，更新最佳選擇
            if (impact < minImpact) {
              minImpact = impact;
              bestPairIndex = i;
              currentRound = r;
            }
          }
        }
        
        // 如果沒有找到理想解，但找到影響最小的選擇
        if (minImpact !== -1) {
          const bestPair = remainingPairs[bestPairIndex];
          rounds[currentRound].push(bestPair);
          teamMatches[bestPair.team1Id].push(currentRound);
          teamMatches[bestPair.team2Id].push(currentRound);
          remainingPairs.splice(bestPairIndex, 1);
        }
      }
    }
    
    // 將輪次安排轉換為最終的比賽列表
    for (let r = 0; r < totalRounds; r++) {
      for (let m = 0; m < rounds[r].length; m++) {
        const match = rounds[r][m];
        matches.push({
          contest_id: match.contestId,
          team1_id: match.team1Id,
          team2_id: match.team2Id,
          winner_team_id: null,
          match_date: new Date().toISOString().split('T')[0],
          score: null,
          sequence: sequence++, // 遞增序號
          round: r + 1 // 保留輪次資訊
        });
      }
    }
    
    return matches;
  };

  // 淘汰賽對戰生成函數
  const generateEliminationMatches = (teams: any[], tableCount: number) => {
    // 計算完整淘汰賽所需的隊伍數量（2的冪次）
    const teamCount = teams.length;
    let fullBracketSize = 1;
    while (fullBracketSize < teamCount) {
      fullBracketSize *= 2;
    }
    
    // 計算第一輪需要進行的比賽數量
    const firstRoundMatches = fullBracketSize - teamCount;
    
    // 打亂隊伍順序，確保隨機配對
    const shuffledTeams = [...teams].sort(() => Math.random() - 0.5);
    
    // 產生第一輪比賽
    const matches = [];
    let sequence = 1;
    
    // 分配直接晉級的隊伍
    const byeTeams = shuffledTeams.slice(0, teamCount - firstRoundMatches * 2);
    const matchTeams = shuffledTeams.slice(teamCount - firstRoundMatches * 2);
    
    // 產生第一輪需要比賽的對戰
    for (let i = 0; i < firstRoundMatches; i++) {
      const team1 = matchTeams[i * 2];
      const team2 = matchTeams[i * 2 + 1];
      
      // 確保ID是數字類型
      const team1Id = typeof team1.contest_team_id === 'string' ? parseInt(team1.contest_team_id) : team1.contest_team_id;
      const team2Id = typeof team2.contest_team_id === 'string' ? parseInt(team2.contest_team_id) : team2.contest_team_id;
      const contestId = typeof team1.contest_id === 'string' ? parseInt(team1.contest_id) : team1.contest_id;
      
      matches.push({
        contest_id: contestId,
        team1_id: team1Id,
        team2_id: team2Id,
        winner_team_id: null,
        match_date: new Date().toISOString().split('T')[0],
        score: null,
        sequence: sequence++, // 遞增序號
        round: 1 // 保留第一輪標示
      });
    }
    
    return matches;
  };

  // 渲染比賽狀態標籤
  const renderStatusBadge = (status: string, contestId: string) => {
    let color = '';
    let text = '';
    
    switch (status) {
      case 'recruiting':
        color = 'bg-blue-500';
        text = '人員招募中';
        break;
      case 'WaitMatchForm':  // 所有隊長都確認名單後的狀態
        color = 'bg-orange-500';
        text = '待管理員產生對戰表';
        break;
      case 'lineup_arrangement':  // 對戰表產生後的狀態
        color = 'bg-yellow-500';
        text = '人員安排中';
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
        <div>
          <div className="flex items-center space-x-4">
            <h2 className="text-2xl font-bold">賽程控制區</h2>
            <button
              onClick={() => navigate('/')}
              className="bg-gray-500 hover:bg-gray-600 text-white px-3 py-1 rounded text-sm"
            >
              回首頁
            </button>
          </div>
          {currentUserTeamName && (
            <p className="text-sm text-gray-600 mt-1">
              目前顯示：{currentUserTeamName} 團隊主辦的比賽
            </p>
          )}
        </div>
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
          目前 {currentUserTeamName} 團隊沒有主辦的比賽，請點擊「建立比賽」按鈕創建新比賽。
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
                  <td className="py-3 px-4 border">{renderStatusBadge(contest.contest_status, contest.contest_id)}</td>
                  <td className="py-3 px-4 border">{(() => { const d = new Date(contest.signup_end_date); return `${d.getMonth() + 1}/${d.getDate()}`; })()}</td>
                  <td className="py-3 px-4 border sticky right-0 bg-white shadow-md z-10">
                    <div className="flex space-x-2">
                      <button
                        className="bg-blue-500 hover:bg-blue-600 text-white px-2 py-1 rounded text-sm"
                        onClick={() => navigate(`/contest/edit/${contest.contest_id}`)}
                      >
                        編輯
                      </button>

                      {contest.contest_status === 'WaitMatchForm' && (
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
                          } else if (contest.contest_status === 'WaitMatchForm') {
                            navigate(`/contest/${contest.contest_id}/join`);
                          } else {
                            navigate(`/contest/${contest.contest_id}/join`);
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
                              : contest.contest_status === 'lineup_arrangement'
                                ? '查看名單'
                                : contest.contest_status === 'WaitMatchForm'
                                  ? '查看隊伍'
                                  : '查看詳情'}
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
          <li>當比賽狀態為「待管理員執行產生對戰表」時，可以產生對戰表。</li>
          <li>循環賽：每隊都會與其他所有隊伍對戰一次。</li>
          <li>淘汰賽：輸一場就淘汰，優勝者晉級下一輪。</li>
          <li>產生對戰表後，將由隊長編排出賽名單。</li>
        </ul>
      </div>
    </div>
  );
};

export default ContestControlPage;