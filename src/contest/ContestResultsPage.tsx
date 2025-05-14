import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../supabaseClient';

interface TeamResult {
  teamId: number;
  teamName: string;
  wins: number;
  matchResults: Record<number, string>; // key是對手隊伍ID，value是比分，例如"3:0"
  gamesWon: number; // 勝場數
  tableNumber?: number; // 勝場數排名
  winningGames: number; // 勝局數
}

interface ResultsTableData {
  teams: TeamResult[];
  teamIdToIndex: Record<number, number>; // 用於快速查找隊伍在teams數組中的索引
}

const ContestResultsPage: React.FC = () => {
  const { contestId } = useParams<{ contestId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [contestName, setContestName] = useState('');
  const [resultsData, setResultsData] = useState<ResultsTableData>({ teams: [], teamIdToIndex: {} });
  const [isAdmin, setIsAdmin] = useState(false);
  const [allScoresFilled, setAllScoresFilled] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [isContestFinished, setIsContestFinished] = useState(false);

  useEffect(() => {
    if (contestId) {
      checkUserRole();
      fetchContestDetails();
      fetchContestResults();
    }
  }, [contestId]);

  const checkUserRole = async () => {
    try {
      const storedUser = JSON.parse(localStorage.getItem('loginUser') || '{}');
      const isUserAdmin = storedUser.role === 'admin' || storedUser.is_admin === true;
      setIsAdmin(isUserAdmin);
    } catch (err) {
      console.error('檢查用戶角色時出錯:', err);
    }
  };

  const fetchContestDetails = async () => {
    try {
      const { data, error } = await supabase
        .from('contest')
        .select('contest_name, contest_status')
        .eq('contest_id', contestId)
        .single();

      if (error) throw error;
      if (data) {
        setContestName(data.contest_name);
        setIsContestFinished(data.contest_status === 'finished');
      }
    } catch (err: any) {
      console.error('獲取比賽詳情錯誤:', err);
      setError(err.message);
    }
  };

  const checkAllScoresFilled = (matchData: any[]) => {
    return matchData && matchData.length > 0 && matchData.every(
      match => match.score !== null && match.score !== undefined && match.score !== ''
    );
  };

  const handleFinishContest = async () => {
    if (!isAdmin || !allScoresFilled) return;
    
    try {
      setUpdating(true);
      const { error } = await supabase
        .from('contest')
        .update({ contest_status: 'finished' })
        .eq('contest_id', contestId);

      if (error) throw error;
      setIsContestFinished(true);
      alert('比賽已成功結束！');
    } catch (err: any) {
      console.error('更新比賽狀態時出錯:', err);
      alert('更新比賽狀態失敗，請稍後再試！');
    } finally {
      setUpdating(false);
    }
  };

  const fetchContestResults = async () => {
    setLoading(true);
    setError('');
    
    try {
      // 1. 獲取所有比賽對戰數據
      const { data: matchData, error: matchError } = await supabase
        .from('contest_match')
        .select('match_id, contest_id, team1_id, team2_id, score, winner_team_id')
        .eq('contest_id', contestId);

      if (matchError) throw matchError;
      
      if (!matchData || matchData.length === 0) {
        setError('沒有找到比賽數據');
        setLoading(false);
        return;
      }

      // 2. 獲取所有參與比賽的隊伍信息
      const teamIds = Array.from(new Set(
        matchData.flatMap(match => [match.team1_id, match.team2_id]).filter(Boolean)
      ));
      
      const { data: teamData, error: teamError } = await supabase
        .from('contest_team')
        .select('contest_team_id, team_name')
        .in('contest_team_id', teamIds);

      if (teamError) throw teamError;
      
      // 3. 獲取比賽明細數據以統計勝局數
      const { data: detailData, error: detailError } = await supabase
        .from('contest_match_detail')
        .select('match_detail_id, match_id, winner_team_id')
        .in('match_id', matchData.map(match => match.match_id));
        
      if (detailError) throw detailError;

      // 4. 處理數據並生成結果表
      const resultsTableData = processMatchResults(matchData, teamData, detailData);
      setResultsData(resultsTableData);
      setAllScoresFilled(checkAllScoresFilled(matchData));
    } catch (err: any) {
      console.error('獲取比賽結果錯誤:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const processMatchResults = (
    matches: any[],
    teams: any[],
    matchDetails: any[]
  ): ResultsTableData => {
    // 初始化結果數據結構
    const resultsData: ResultsTableData = {
      teams: [],
      teamIdToIndex: {}
    };

    // 首先為每個隊伍創建一個結果對象
    teams.forEach((team, index) => {
      resultsData.teams.push({
        teamId: team.contest_team_id,
        teamName: team.team_name,
        wins: 0,
        matchResults: {},
        gamesWon: 0,
        winningGames: 0 // 初始化勝局數
      });
      resultsData.teamIdToIndex[team.contest_team_id] = index;
    });

    // 處理每場比賽結果
    matches.forEach(match => {
      if (!match.score) return; // 跳過沒有比分的比賽
      
      const team1Id = match.team1_id;
      const team2Id = match.team2_id;
      const score = match.score;
      const winnerId = match.winner_team_id;
      
      if (!team1Id || !team2Id) return; // 跳過沒有隊伍ID的比賽
      
      const team1Index = resultsData.teamIdToIndex[team1Id];
      const team2Index = resultsData.teamIdToIndex[team2Id];
      
      if (team1Index === undefined || team2Index === undefined) return; // 跳過找不到隊伍索引的比賽
      
      // 記錄比分 - 這裡直接使用原始比分
      resultsData.teams[team1Index].matchResults[team2Id] = score;
      
      // 自動生成反向比分 - 解析原始比分並反轉
      if (score && score.includes(':')) {
        const [team1Score, team2Score] = score.split(':');
        const reverseScore = `${team2Score}:${team1Score}`;
        resultsData.teams[team2Index].matchResults[team1Id] = reverseScore;
      }
      
      // 更新勝場數
      if (winnerId === team1Id) {
        resultsData.teams[team1Index].wins += 1;
      } else if (winnerId === team2Id) {
        resultsData.teams[team2Index].wins += 1;
      }
    });

    // 統計勝局數 - 從match_detail表中計算每個隊伍贏得的局數
    matchDetails.forEach(detail => {
      const winnerId = detail.winner_team_id;
      if (winnerId && resultsData.teamIdToIndex[winnerId] !== undefined) {
        const winnerIndex = resultsData.teamIdToIndex[winnerId];
        resultsData.teams[winnerIndex].winningGames += 1;
      }
    });

    // 計算總勝場數並排序
    resultsData.teams.forEach(team => {
      team.gamesWon = team.wins;
    });

    // 先按勝場數排序，若相同則按勝局數排序
    resultsData.teams.sort((a, b) => {
      // 首先按勝場數降序排列
      if (b.gamesWon !== a.gamesWon) {
        return b.gamesWon - a.gamesWon;
      }
      // 如果勝場數相同，則按勝局數降序排列
      return b.winningGames - a.winningGames;
    });
    
    // 分配排名（勝場數和勝局數都相同時才有相同排名）
    let currentRank = 1;
    let previousWins = -1;
    let previousWinningGames = -1;
    resultsData.teams.forEach((team, index) => {
      if (team.gamesWon !== previousWins || team.winningGames !== previousWinningGames) {
        currentRank = index + 1;
        previousWins = team.gamesWon;
        previousWinningGames = team.winningGames;
      }
      team.tableNumber = currentRank;
    });

    return resultsData;
  };

  return (
    <div className="container mx-auto px-4 py-8">
      {loading ? (
        <p className="text-center">載入中...</p>
      ) : error ? (
        <p className="text-center text-red-500">{error}</p>
      ) : (
        <div>
          <div className="flex items-center mb-6">
            <button 
              onClick={() => navigate(-1)} 
              className="mr-4 bg-gray-200 hover:bg-gray-300 p-2 rounded-full"
            >
              &larr;
            </button>
            <h1 className="text-2xl font-bold">{contestName} - 比賽名次分析</h1>
          </div>
          
          {resultsData.teams.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              沒有可用的比賽結果數據
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse border border-gray-300 mb-8">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="py-3 px-4 border text-center">隊伍/對手</th>
                    {resultsData.teams.map(team => (
                      <th key={`head-${team.teamId}`} className="py-3 px-4 border text-center">
                        {team.teamName} ({team.teamId})
                      </th>
                    ))}
                    <th className="py-3 px-4 border text-center">名次</th>
                  </tr>
                </thead>
                <tbody>
                  {resultsData.teams.map(rowTeam => (
                    <tr key={`row-${rowTeam.teamId}`} className="hover:bg-gray-50">
                      <td className="py-3 px-4 border font-bold">
                        {rowTeam.teamName} ({rowTeam.teamId})
                      </td>
                      {resultsData.teams.map(colTeam => (
                        <td key={`cell-${rowTeam.teamId}-${colTeam.teamId}`} className="py-3 px-4 border text-center">
                          {rowTeam.teamId === colTeam.teamId ? (
                            '—'
                          ) : (
                            <span className={
                              rowTeam.matchResults[colTeam.teamId] && 
                              parseInt(rowTeam.matchResults[colTeam.teamId].split(':')[0]) > 
                              parseInt(rowTeam.matchResults[colTeam.teamId].split(':')[1]) 
                              ? 'text-orange-500 font-bold' : ''
                            }>
                              {rowTeam.matchResults[colTeam.teamId] || '-'}
                            </span>
                          )}
                        </td>
                      ))}
                      <td className="py-3 px-4 border text-center font-bold">
                        {rowTeam.tableNumber}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-gray-50">
                    <td className="py-3 px-4 border font-bold text-blue-600">勝場數</td>
                    {resultsData.teams.map(team => (
                      <td key={`wins-${team.teamId}`} className="py-3 px-4 border text-center font-bold text-blue-600">
                        {team.gamesWon}
                      </td>
                    ))}
                    <td className="py-3 px-4 border">—</td>
                  </tr>
                  <tr className="bg-gray-50">
                    <td className="py-3 px-4 border font-bold text-green-600">勝局數</td>
                    {resultsData.teams.map(team => (
                      <td key={`winning-games-${team.teamId}`} className="py-3 px-4 border text-center font-bold text-green-600">
                        {team.winningGames}
                      </td>
                    ))}
                    <td className="py-3 px-4 border">—</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          
          {isAdmin && (allScoresFilled || isContestFinished) && (
            <div className="mt-4 mb-6">
              <button
                onClick={handleFinishContest}
                disabled={updating || isContestFinished}
                className={`px-6 py-2 rounded ${isContestFinished 
                  ? 'bg-gray-500 cursor-not-allowed' 
                  : 'bg-green-600 hover:bg-green-700'} text-white`}
              >
                {updating ? '處理中...' : isContestFinished ? '比賽已結束' : '結束比賽'}
              </button>
            </div>
          )}
          <div className="mt-6 p-4 bg-yellow-50 border border-yellow-200 rounded">
            <h3 className="font-bold text-yellow-800 mb-2">說明</h3>
            <ul className="list-disc pl-5 text-sm text-yellow-700">
              <li>表格中顯示了每個隊伍間的比賽結果。</li>
              <li>行隊伍對戰列隊伍的比分直接顯示，格式為 "行隊伍得分:列隊伍得分"。</li>
              <li>勝利的比分以橘色顯示。</li>
              <li>名次首先根據勝場數排序，若勝場數相同則根據勝局數排序。</li>
              <li>勝局數統計每個隊伍在所有比賽中獲勝的局數總和。</li>
              <li>隊伍名稱旁的數字為隊伍ID (team_id)。</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
};

export default ContestResultsPage;
