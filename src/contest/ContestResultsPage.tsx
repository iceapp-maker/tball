import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../supabaseClient';

interface TeamResult {
  teamId: number;
  teamName: string;
  wins: number;
  matchResults: Record<number, string>;
  gamesWon: number;
  tableNumber?: number;
  winningGames: number;
}

interface ResultsTableData {
  teams: TeamResult[];
  teamIdToIndex: Record<number, number>;
}

interface DetailedMatch {
  matchId: number;
  team1Name: string;
  team2Name: string;
  details: {
    team1Members: string[];
    team2Members: string[];
    winnerTeamId: number;
    sequence: number;
    score?: string;
  }[];
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
  const [detailedMatches, setDetailedMatches] = useState<DetailedMatch[]>([]);
  const [showDetailedMatches, setShowDetailedMatches] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [matchesData, setMatchesData] = useState<any[]>([]);
  const [maxSequence, setMaxSequence] = useState<number>(0); // 記錄最大sequence值
  const [hasIncompleteMatches, setHasIncompleteMatches] = useState(false); // 新增：檢查是否有未完成的比賽

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

  // 新增：檢查是否有未完成的比賽
  const checkIncompleteMatches = (teams: TeamResult[], maxSeq: number) => {
    if (maxSeq === 0) return false;
    
    for (const rowTeam of teams) {
      for (const colTeam of teams) {
        if (rowTeam.teamId === colTeam.teamId) continue;
        
        const scoreString = rowTeam.matchResults[colTeam.teamId];
        if (scoreString && scoreString !== '-') {
          const [scoreA, scoreB] = scoreString.split(':').map(Number);
          if (!isNaN(scoreA) && !isNaN(scoreB) && (scoreA + scoreB) < maxSeq) {
            return true;
          }
        }
      }
    }
    return false;
  };

  const handleFinishContest = async () => {
    if (!isAdmin || !allScoresFilled || hasIncompleteMatches) return;
    
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

  const fetchDetailedMatches = async () => {
    if (!isContestFinished) return;
    
    setLoadingDetails(true);
    try {
      const { data: matchDetails, error: detailsError } = await supabase
        .from('contest_match_detail')
        .select(`
          match_detail_id,
          match_id,
          team1_member_ids,
          team2_member_ids,
          winner_team_id,
          sequence,
          score
        `)
        .in('match_id', resultsData.teams.length > 0 ? 
          await supabase
            .from('contest_match')
            .select('match_id')
            .eq('contest_id', contestId)
            .then(({ data }) => data?.map(m => m.match_id) || [])
        : []);

      if (detailsError) throw detailsError;

      const { data: matches, error: matchesError } = await supabase
        .from('contest_match')
        .select('match_id, team1_id, team2_id')
        .eq('contest_id', contestId);

      if (matchesError) throw matchesError;

      const teamIds = Array.from(new Set(
        matches?.flatMap(match => [match.team1_id, match.team2_id]).filter(Boolean) || []
      ));

      const { data: teams, error: teamsError } = await supabase
        .from('contest_team')
        .select('contest_team_id, team_name')
        .in('contest_team_id', teamIds);

      if (teamsError) throw teamsError;

      const { data: members, error: membersError } = await supabase
        .from('contest_team_member')
        .select('contest_team_id, member_id, member_name')
        .in('contest_team_id', teamIds);

      if (membersError) throw membersError;

      const processedMatches = processDetailedMatches(matchDetails || [], matches || [], teams || [], members || []);
      setDetailedMatches(processedMatches);
      setMatchesData(matches || []);
      
    } catch (err: any) {
      console.error('獲取詳細對戰記錄錯誤:', err);
    } finally {
      setLoadingDetails(false);
    }
  };

  const processDetailedMatches = (
    details: any[],
    matches: any[],
    teams: any[],
    members: any[]
  ): DetailedMatch[] => {
    const teamMap = new Map(teams.map(team => [team.contest_team_id, team.team_name]));
    const memberMap = new Map(members.map(member => [member.member_id, member.member_name]));
    
    const matchGroups = new Map<number, any[]>();
    details.forEach(detail => {
      if (!matchGroups.has(detail.match_id)) {
        matchGroups.set(detail.match_id, []);
      }
      matchGroups.get(detail.match_id)?.push(detail);
    });

    const result: DetailedMatch[] = [];
    
    matchGroups.forEach((matchDetails, matchId) => {
      const match = matches.find(m => m.match_id === matchId);
      if (!match) return;

      const team1Name = teamMap.get(match.team1_id) || '未知隊伍';
      const team2Name = teamMap.get(match.team2_id) || '未知隊伍';

      const processedDetails = matchDetails
        .sort((a, b) => a.sequence - b.sequence)
        .map(detail => {
          const team1Members = (detail.team1_member_ids || []).map((id: string) => 
            memberMap.get(id) || '未知選手'
          );
          const team2Members = (detail.team2_member_ids || []).map((id: string) => 
            memberMap.get(id) || '未知選手'
          );

          return {
            team1Members,
            team2Members,
            winnerTeamId: detail.winner_team_id,
            sequence: detail.sequence,
            score: detail.score
          };
        });

      result.push({
        matchId,
        team1Name,
        team2Name,
        details: processedDetails
      });
    });

    return result.sort((a, b) => a.matchId - b.matchId);
  };

  const toggleDetailedMatches = () => {
    if (!showDetailedMatches && detailedMatches.length === 0) {
      fetchDetailedMatches();
    }
    setShowDetailedMatches(!showDetailedMatches);
  };

  // 獲取最大sequence值的函數（修改為返回值而不是設置狀態）
  const getMaxSequenceValue = async (): Promise<number> => {
    try {
      // 先獲取該比賽的所有match_id
      const { data: matchData, error: matchError } = await supabase
        .from('contest_match')
        .select('match_id')
        .eq('contest_id', contestId);

      if (matchError) throw matchError;
      
      if (!matchData || matchData.length === 0) {
        return 0;
      }

      const matchIds = matchData.map(match => match.match_id);
      
      // 獲取這些match的所有detail記錄，找出最大sequence
      const { data: detailData, error: detailError } = await supabase
        .from('contest_match_detail')
        .select('sequence')
        .in('match_id', matchIds);

      if (detailError) throw detailError;
      
      if (detailData && detailData.length > 0) {
        const maxSeq = Math.max(...detailData.map(detail => detail.sequence || 0));
        return maxSeq;
      } else {
        return 0;
      }
    } catch (err: any) {
      console.error('獲取最大sequence值錯誤:', err);
      return 0;
    }
  };

  const fetchContestResults = async () => {
    setLoading(true);
    setError('');
    
    try {
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

      const teamIds = Array.from(new Set(
        matchData.flatMap(match => [match.team1_id, match.team2_id]).filter(Boolean)
      ));
      
      const { data: teamData, error: teamError } = await supabase
        .from('contest_team')
        .select('contest_team_id, team_name')
        .in('contest_team_id', teamIds);

      if (teamError) throw teamError;
      
      const { data: detailData, error: detailError } = await supabase
        .from('contest_match_detail')
        .select('match_detail_id, match_id, winner_team_id, score')
        .in('match_id', matchData.map(match => match.match_id));
        
      if (detailError) throw detailError;

      // 先獲取最大sequence值
      const maxSeq = await getMaxSequenceValue();
      setMaxSequence(maxSeq);

      const resultsTableData = processMatchResults(matchData, teamData, detailData);
      setResultsData(resultsTableData);
      setAllScoresFilled(checkAllScoresFilled(matchData));
      
      // 直接檢查未完成比賽
      const incomplete = checkIncompleteMatches(resultsTableData.teams, maxSeq);
      setHasIncompleteMatches(incomplete);
      
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
    const resultsData: ResultsTableData = {
      teams: [],
      teamIdToIndex: {}
    };

    teams.forEach((team, index) => {
      resultsData.teams.push({
        teamId: team.contest_team_id,
        teamName: team.team_name,
        wins: 0,
        matchResults: {},
        gamesWon: 0,
        winningGames: 0
      });
      resultsData.teamIdToIndex[team.contest_team_id] = index;
    });

    matches.forEach(match => {
      const team1Id = match.team1_id;
      const team2Id = match.team2_id;
      
      if (!team1Id || !team2Id) return;
      
      const team1Index = resultsData.teamIdToIndex[team1Id];
      const team2Index = resultsData.teamIdToIndex[team2Id];
      
      if (team1Index === undefined || team2Index === undefined) return;
      
      const matchDetailRecords = matchDetails.filter(detail => detail.match_id === match.match_id);
      let team1Wins = 0;
      let team2Wins = 0;
      
      matchDetailRecords.forEach(detail => {
        if (detail.winner_team_id === team1Id) {
          team1Wins++;
        } else if (detail.winner_team_id === team2Id) {
          team2Wins++;
        }
      });
      
      const scoreStr = `${team1Wins}:${team2Wins}`;
      resultsData.teams[team1Index].matchResults[team2Id] = scoreStr;
      
      const reverseScore = `${team2Wins}:${team1Wins}`;
      resultsData.teams[team2Index].matchResults[team1Id] = reverseScore;
      
      if (team1Wins > team2Wins) {
        resultsData.teams[team1Index].wins += 1;
      } else if (team2Wins > team1Wins) {
        resultsData.teams[team2Index].wins += 1;
      }
      
      resultsData.teams[team1Index].winningGames += team1Wins;
      resultsData.teams[team2Index].winningGames += team2Wins;
    });

    resultsData.teams.forEach(team => {
      team.gamesWon = team.wins;
    });

    const teamsByWins: Record<number, TeamResult[]> = {};
    resultsData.teams.forEach(team => {
      if (!teamsByWins[team.gamesWon]) {
        teamsByWins[team.gamesWon] = [];
      }
      teamsByWins[team.gamesWon].push(team);
    });

    const sortedTeams: TeamResult[] = [];
    Object.keys(teamsByWins)
      .map(Number)
      .sort((a, b) => b - a)
      .forEach(wins => {
        const teamsWithSameWins = teamsByWins[wins];
        
        if (teamsWithSameWins.length === 1) {
          sortedTeams.push(teamsWithSameWins[0]);
          return;
        }
        
        const sortedGroup = sortTeamsByHeadToHead(teamsWithSameWins, resultsData.teamIdToIndex);
        sortedTeams.push(...sortedGroup);
      });

    resultsData.teams = sortedTeams;
    
    resultsData.teamIdToIndex = {};
    resultsData.teams.forEach((team, index) => {
      resultsData.teamIdToIndex[team.teamId] = index;
    });
    
    let currentRank = 1;
    resultsData.teams.forEach((team, index) => {
      team.tableNumber = currentRank++;
    });

    return resultsData;
  };

  const sortTeamsByHeadToHead = (teams: TeamResult[], teamIdToIndex: Record<number, number>) => {
    if (teams.length === 2) {
      const team1 = teams[0];
      const team2 = teams[1];
      
      const matchResult = team1.matchResults[team2.teamId];
      if (matchResult) {
        const [team1Score, team2Score] = matchResult.split(':').map(Number);
        if (team1Score > team2Score) {
          return [team1, team2];
        } else if (team1Score < team2Score) {
          return [team2, team1];
        }
      }
      
      return [...teams].sort((a, b) => b.winningGames - a.winningGames);
    }
    
    const hasCircularWinning = checkCircularWinning(teams);
    
    if (hasCircularWinning) {
      return [...teams].sort((a, b) => b.winningGames - a.winningGames);
    }
    
    const winMatrix: Record<number, Set<number>> = {};
    teams.forEach(team => {
      winMatrix[team.teamId] = new Set();
    });
    
    teams.forEach(team => {
      teams.forEach(opponent => {
        if (team.teamId === opponent.teamId) return;
        
        const matchResult = team.matchResults[opponent.teamId];
        if (matchResult) {
          const [teamScore, opponentScore] = matchResult.split(':').map(Number);
          if (teamScore > opponentScore) {
            winMatrix[team.teamId].add(opponent.teamId);
          }
        }
      });
    });
    
    const directWins: Record<number, number> = {};
    teams.forEach(team => {
      directWins[team.teamId] = winMatrix[team.teamId].size;
    });
    
    return [...teams].sort((a, b) => {
      const aWins = directWins[a.teamId];
      const bWins = directWins[b.teamId];
      
      if (aWins !== bWins) {
        return bWins - aWins;
      }
      
      return b.winningGames - a.winningGames;
    });
  };
  
  const checkCircularWinning = (teams: TeamResult[]) => {
    const winGraph: Record<number, number[]> = {};
    teams.forEach(team => {
      winGraph[team.teamId] = [];
    });
    
    teams.forEach(team => {
      teams.forEach(opponent => {
        if (team.teamId === opponent.teamId) return;
        
        const matchResult = team.matchResults[opponent.teamId];
        if (matchResult) {
          const [teamScore, opponentScore] = matchResult.split(':').map(Number);
          if (teamScore > opponentScore) {
            winGraph[team.teamId].push(opponent.teamId);
          }
        }
      });
    });
    
    const visited = new Set<number>();
    const recursionStack = new Set<number>();
    
    function hasCycle(node: number): boolean {
      if (recursionStack.has(node)) return true;
      if (visited.has(node)) return false;
      
      visited.add(node);
      recursionStack.add(node);
      
      for (const neighbor of winGraph[node]) {
        if (hasCycle(neighbor)) return true;
      }
      
      recursionStack.delete(node);
      return false;
    }
    
    for (const team of teams) {
      if (!visited.has(team.teamId) && hasCycle(team.teamId)) {
        return true;
      }
    }
    
    return false;
  };

  // 檢查比分是否需要粉紅色背景的函數
  const shouldHighlightCell = (scoreString: string): boolean => {
    if (!scoreString || scoreString === '-' || maxSequence === 0) {
      return false;
    }
    
    const [scoreA, scoreB] = scoreString.split(':').map(Number);
    if (isNaN(scoreA) || isNaN(scoreB)) {
      return false;
    }
    
    return (scoreA + scoreB) < maxSequence;
  };

  // 修正useEffect，當maxSequence更新時重新檢查未完成比賽
  useEffect(() => {
    if (resultsData.teams.length > 0 && maxSequence > 0) {
      const incomplete = checkIncompleteMatches(resultsData.teams, maxSequence);
      setHasIncompleteMatches(incomplete);
    }
  }, [maxSequence, resultsData]);

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
                        {team.teamName}
                      </th>
                    ))}
                    <th className="py-3 px-4 border text-center">名次</th>
                  </tr>
                </thead>
                <tbody>
                  {resultsData.teams.map(rowTeam => (
                    <tr key={`row-${rowTeam.teamId}`} className="hover:bg-gray-50">
                      <td className="py-3 px-4 border font-bold">
                        {rowTeam.teamName}
                      </td>
                      {resultsData.teams.map(colTeam => (
                        <td key={`cell-${rowTeam.teamId}-${colTeam.teamId}`} 
                            className={`py-3 px-4 border text-center ${
                              rowTeam.teamId === colTeam.teamId 
                                ? '' 
                                : shouldHighlightCell(rowTeam.matchResults[colTeam.teamId]) 
                                  ? 'bg-pink-200' 
                                  : ''
                            }`}>
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
                    <td className="py-3 px-4 border font-bold text-blue-600">勝場(隊)數</td>
                    {resultsData.teams.map(team => (
                      <td key={`wins-${team.teamId}`} className="py-3 px-4 border text-center font-bold text-blue-600">
                        {team.gamesWon}
                      </td>
                    ))}
                    <td className="py-3 px-4 border">—</td>
                  </tr>
                  <tr className="bg-gray-50">
                    <td className="py-3 px-4 border font-bold text-green-600">勝局(點)數</td>
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
          
          {isContestFinished && (
            <div className="mt-8 mb-6">
              <button
                onClick={toggleDetailedMatches}
                className="flex items-center justify-between w-full bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg px-4 py-3 text-left transition-colors"
              >
                <span className="text-lg font-semibold text-blue-800">詳細個人對戰記錄</span>
                <span className="text-blue-600 text-xl">
                  {showDetailedMatches ? '▲' : '▼'}
                </span>
              </button>
              
              {showDetailedMatches && (
                <div className="mt-4 border border-gray-200 rounded-lg bg-white">
                  {loadingDetails ? (
                    <div className="p-6 text-center text-gray-500">載入詳細記錄中...</div>
                  ) : detailedMatches.length === 0 ? (
                    <div className="p-6 text-center text-gray-500">沒有找到詳細對戰記錄</div>
                  ) : (
                    <div className="p-4">
                      {detailedMatches.map((match) => (
                        <div key={match.matchId} className="mb-6 last:mb-0">
                          <div className="bg-gray-100 px-4 py-2 rounded-t-lg">
                            <h3 className="font-bold text-lg text-gray-800">
                              {match.team1Name} vs {match.team2Name}
                            </h3>
                          </div>
                          <div className="border border-t-0 border-gray-200 rounded-b-lg">
                            {match.details.length === 0 ? (
                              <div className="p-4 text-gray-500 text-center">沒有詳細對戰數據</div>
                            ) : (
                              <div className="divide-y divide-gray-200">
                                {match.details.map((detail, index) => {
                                  const matchInfo = matchesData?.find(m => m.match_id === match.matchId);
                                  const isTeam1Winner = detail.winnerTeamId === matchInfo?.team1_id;
                                  const isTeam2Winner = detail.winnerTeamId === matchInfo?.team2_id;
                                  
                                  return (
                                    <div key={index} className="p-3 hover:bg-gray-50">
                                      <div className="flex items-center justify-between">
                                        <div className="flex-1">
                                          <span className="text-sm text-gray-600">第 {detail.sequence} 局：</span>
                                        </div>
                                      </div>
                                      <div className="mt-2 flex items-center justify-between">
                                        <div className="flex items-center">
                                          {isTeam1Winner && (
                                            <span className="mr-2 text-green-600">🏆</span>
                                          )}
                                          <span>{detail.team1Members.join(', ')}</span>
                                        </div>
                                        <div className="mx-4 font-bold">
                                          {detail.score || 'vs'}
                                        </div>
                                        <div className="flex items-center">
                                          <span>{detail.team2Members.join(', ')}</span>
                                          {isTeam2Winner && (
                                            <span className="ml-2 text-green-600">🏆</span>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          
          {/* 修正：只有當管理員、所有比分已填寫、且沒有未完成比賽時才顯示結束比賽按鈕 */}
          {isAdmin && allScoresFilled && !hasIncompleteMatches && !isContestFinished && (
            <div className="mt-4 mb-6">
              <button
                onClick={handleFinishContest}
                disabled={updating}
                className="px-6 py-2 rounded bg-green-600 hover:bg-green-700 text-white"
              >
                {updating ? '處理中...' : '結束比賽'}
              </button>
            </div>
          )}
          
          {/* 當有未完成比賽時顯示提示訊息 */}
          {isAdmin && allScoresFilled && hasIncompleteMatches && !isContestFinished && (
            <div className="mt-4 mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded">
              <p className="text-yellow-800 font-medium">
                ⚠️ 比賽尚未完全結束，仍有未完成的對戰（粉紅色背景的比分）。
              </p>
            </div>
          )}
          
          <div className="mt-6 p-4 bg-yellow-50 border border-yellow-200 rounded">
            <h3 className="font-bold text-yellow-800 mb-2">說明</h3>
            <ul className="list-disc pl-5 text-sm text-yellow-700">
              <li>表格中顯示了每個隊伍間的比賽結果。</li>
              <li>比分顯示格式為 "直列隊伍得分:橫列隊伍得分"。</li>
              <li>比分以橘色顯示直列隊伍獲勝。</li>
              <li>當對戰賽程未完成，該格子會以粉紅色背景顯示。</li>
              <li>名次首先根據勝場(隊)數排序。</li>
              <li>當兩隊勝場(隊)數相同時，直接對戰獲勝者排名較前。</li>
              <li>當三隊或更多隊勝場(隊)數相同且存在循環勝負關係時(例如A勝B、B勝C、C勝A)，則按勝局(點)數排序。</li>
              <li>勝局(點)數統計每個隊伍在所有比賽中獲勝的局(點)數總和。</li>             
              {isContestFinished && (
                <li className="text-blue-700 font-medium">比賽結束後可展開查看詳細個人對戰記錄，包含每局選手對戰情況。</li>
              )}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
};

export default ContestResultsPage;
