import { supabase } from '../../supabaseClient';

/**
 * 通用的結束賽事函數
 * 適用於所有賽制（循環賽、淘汰賽）和所有賽事類型（單一賽事、混合賽子賽事）
 * 從 ContestControlPage.tsx 抽取的共用邏輯
 * 
 * @param contestId 賽事ID
 * @returns Promise<boolean> 是否成功結束賽事
 */
export const finishContest = async (contestId: string): Promise<boolean> => {
  try {
    console.log(`🏁 開始結束賽事: ${contestId}`);

    // 獲取賽事資訊
    const { data: contestData, error: contestError } = await supabase
      .from('contest')
      .select('*')
      .eq('contest_id', contestId)
      .single();

    if (contestError) {
      console.error('獲取賽事資料失敗:', contestError);
      throw contestError;
    }

    console.log('📊 賽事資料:', contestData);

    // 檢查是否為子賽事（混合賽的一部分）
    if (contestData.parent_contest_id) {
      console.log('🔄 這是子賽事，需要處理晉級邏輯');
      
      // 獲取晉級隊伍數量
      let advancementCount = 1; // 預設晉級1隊
      if (contestData.advancement_rules?.advancement_count) {
        advancementCount = contestData.advancement_rules.advancement_count;
      } else if (contestData.advancement_rules?.advances) {
        advancementCount = contestData.advancement_rules.advances;
      } else if (contestData.advancement_rules?.advancement_team_count) {
        advancementCount = contestData.advancement_rules.advancement_team_count;
      }

      console.log(`🎯 目標晉級隊伍數量: ${advancementCount}`);

      let qualifiedTeams: any[] = [];

      // 根據比賽模式計算晉級隊伍
      if (contestData.match_mode === 'round_robin') {
        console.log('🔄 循環賽模式，計算晉級隊伍');
        qualifiedTeams = await calculateRoundRobinQualifiedTeams(contestId, advancementCount);
      } else if (contestData.match_mode === 'elimination') {
        console.log('🏆 淘汰賽模式，計算晉級隊伍');
        qualifiedTeams = await getEliminationQualifiedTeams(contestId, advancementCount);
      }

      console.log('✅ 計算出的晉級隊伍:', qualifiedTeams);

      // 更新advancement_rules，加入qualified_teams
      const updatedAdvancementRules = {
        ...contestData.advancement_rules,
        qualified_teams: qualifiedTeams
      };

      console.log('💾 準備更新advancement_rules:', updatedAdvancementRules);

      // 更新賽事狀態和晉級規則
      const { error: updateError } = await supabase
        .from('contest')
        .update({
          contest_status: 'finished',
          advancement_rules: updatedAdvancementRules
        })
        .eq('contest_id', contestId);

      if (updateError) {
        console.error('更新賽事狀態失敗:', updateError);
        throw updateError;
      }

      // 處理晉級隊伍：從contest_group_assignment中移除晉級隊伍
      if (qualifiedTeams.length > 0) {
        console.log('🔄 處理晉級隊伍的分組邏輯');
        
        const qualifiedTeamIds = qualifiedTeams.map(team => team.contest_team_id);
        console.log('📋 晉級隊伍ID列表:', qualifiedTeamIds);

        // 從contest_group_assignment中移除晉級隊伍（這些隊伍將進入下一輪）
        const { error: removeError } = await supabase
          .from('contest_group_assignment')
          .delete()
          .eq('group_contest_id', contestId)
          .in('contest_team_id', qualifiedTeamIds);

        if (removeError) {
          console.error('移除晉級隊伍失敗:', removeError);
          // 不拋出錯誤，因為主要邏輯已完成
        } else {
          console.log('✅ 成功移除晉級隊伍的分組記錄');
        }
      }

    } else {
      console.log('📝 這是單一賽事，只需更新狀態');
      
      // 單一賽事，只需更新狀態
      const { error: updateError } = await supabase
        .from('contest')
        .update({ contest_status: 'finished' })
        .eq('contest_id', contestId);

      if (updateError) {
        console.error('更新賽事狀態失敗:', updateError);
        throw updateError;
      }
    }

    console.log('🎉 賽事結束成功!');
    return true;

  } catch (error) {
    console.error('❌ 結束賽事失敗:', error);
    return false;
  }
};

/**
 * 計算循環賽晉級隊伍
 * 從 ContestControlPage.tsx 抽取的邏輯
 * 
 * @param contestId 子賽事ID
 * @param advancementCount 晉級隊伍數量
 * @returns Promise<any[]> 晉級隊伍列表
 */
export const calculateRoundRobinQualifiedTeams = async (contestId: string, advancementCount: number): Promise<any[]> => {
  try {
    console.log(`🔍 開始計算子賽事 ${contestId} 的晉級隊伍，目標晉級數量: ${advancementCount}`);
    
    // 獲取比賽記錄
    const { data: matches, error: matchError } = await supabase
      .from('contest_match')
      .select('match_id, team1_id, team2_id, winner_team_id')
      .eq('contest_id', contestId);

    if (matchError) {
      console.error('獲取比賽記錄失敗:', matchError);
      throw matchError;
    }
    
    console.log(`📊 找到 ${matches?.length || 0} 場比賽記錄:`, matches);

    // ✅ 修正：對於子賽事，應該從 contest_group_assignment 表獲取參賽隊伍
    // 然後再透過 contest_team_id 獲取隊伍名稱
    const { data: assignments, error: assignmentError } = await supabase
      .from('contest_group_assignment')
      .select('contest_team_id')
      .eq('group_contest_id', contestId);

    if (assignmentError) {
      console.error('獲取隊伍分配失敗:', assignmentError);
      throw assignmentError;
    }
    
    console.log(`👥 找到 ${assignments?.length || 0} 支參賽隊伍:`, assignments);

    if (!assignments || assignments.length === 0) {
      console.warn('⚠️ 沒有找到參賽隊伍');
      return [];
    }

    // 獲取隊伍詳細資料（包含隊伍名稱）
    const teamIds = assignments.map(a => a.contest_team_id);
    const { data: teams, error: teamError } = await supabase
      .from('contest_team')
      .select('contest_team_id, team_name')
      .in('contest_team_id', teamIds);

    if (teamError) {
      console.error('獲取隊伍詳細資料失敗:', teamError);
      throw teamError;
    }
    
    console.log(`🏷️ 隊伍詳細資料:`, teams);

    // 獲取比賽詳情（每局勝負）
    const matchIds = matches?.map(match => match.match_id) || [];
    console.log(`🔍 比賽ID列表:`, matchIds);
    
    if (matchIds.length === 0) {
      console.warn('⚠️ 沒有比賽記錄，無法計算晉級隊伍');
      return [];
    }
    
    const { data: matchDetails, error: detailError } = await supabase
      .from('contest_match_detail')
      .select('match_id, winner_team_id')
      .in('match_id', matchIds);

    if (detailError) {
      console.error('獲取比賽詳情失敗:', detailError);
      throw detailError;
    }
    
    console.log(`📋 比賽詳情記錄 ${matchDetails?.length || 0} 筆:`, matchDetails);

    // 使用與 ContestResultsPage 完全相同的排序邏輯
    const resultsData = {
      teams: [] as any[],
      teamIdToIndex: {} as Record<number, number>
    };

    // 初始化隊伍資料
    teams?.forEach((team, index) => {
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

    // 處理比賽結果
    matches?.forEach(match => {
      const team1Id = match.team1_id;
      const team2Id = match.team2_id;
      
      if (!team1Id || !team2Id) return;
      
      const team1Index = resultsData.teamIdToIndex[team1Id];
      const team2Index = resultsData.teamIdToIndex[team2Id];
      
      if (team1Index === undefined || team2Index === undefined) return;
      
      const matchDetailRecords = matchDetails?.filter(detail => detail.match_id === match.match_id) || [];
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

    // 設置 gamesWon
    resultsData.teams.forEach(team => {
      team.gamesWon = team.wins;
    });

    // 按勝場數分組並排序（與 ContestResultsPage 相同邏輯）
    const teamsByWins: Record<number, any[]> = {};
    resultsData.teams.forEach(team => {
      if (!teamsByWins[team.gamesWon]) {
        teamsByWins[team.gamesWon] = [];
      }
      teamsByWins[team.gamesWon].push(team);
    });

    const sortedTeams: any[] = [];
    Object.keys(teamsByWins)
      .map(Number)
      .sort((a, b) => b - a)
      .forEach(wins => {
        const teamsWithSameWins = teamsByWins[wins];
        
        if (teamsWithSameWins.length === 1) {
          sortedTeams.push(teamsWithSameWins[0]);
          return;
        }
        
        const sortedGroup = sortTeamsByHeadToHeadAdvancement(teamsWithSameWins);
        sortedTeams.push(...sortedGroup);
      });

    console.log(`📋 排序後的隊伍:`, sortedTeams.map(t => `${t.teamName}(${t.wins}勝,${t.winningGames}局)`));

    // 取前N名晉級隊伍
    const qualifiedTeams = sortedTeams
      .slice(0, advancementCount)
      .map((team, index) => ({
        contest_team_id: team.teamId,
        team_name: team.teamName,
        rank: index + 1,
        wins: team.wins,
        winning_games: team.winningGames,
        qualified_at: new Date().toISOString()
      }));

    console.log(`✅ 計算完成，晉級隊伍 (前${advancementCount}名):`, qualifiedTeams);
    return qualifiedTeams;
  } catch (err) {
    console.error('❌ 計算循環賽晉級隊伍失敗:', err);
    return [];
  }
};

/**
 * 計算淘汰賽晉級隊伍
 * 從 ContestControlPage.tsx 抽取的邏輯
 * 
 * @param contestId 子賽事ID
 * @param advancementCount 晉級隊伍數量
 * @returns Promise<any[]> 晉級隊伍列表
 */
export const getEliminationQualifiedTeams = async (contestId: string, advancementCount: number): Promise<any[]> => {
  try {
    console.log(`🏆 開始計算淘汰賽 ${contestId} 的晉級隊伍，目標晉級數量: ${advancementCount}`);
    
    // 獲取所有比賽記錄
    const { data: matches, error: matchError } = await supabase
      .from('contest_match')
      .select('match_id, team1_id, team2_id, winner_team_id, round')
      .eq('contest_id', contestId)
      .order('round', { ascending: false }); // 從最後一輪開始

    if (matchError) {
      console.error('獲取比賽記錄失敗:', matchError);
      throw matchError;
    }

    console.log(`📊 找到 ${matches?.length || 0} 場比賽記錄:`, matches);

    if (!matches || matches.length === 0) {
      console.warn('⚠️ 沒有比賽記錄');
      return [];
    }

    // 獲取最後一輪的比賽
    const finalRound = Math.max(...matches.map(m => m.round));
    const finalMatches = matches.filter(m => m.round === finalRound);
    
    console.log(`🏁 決賽輪次: ${finalRound}, 比賽數: ${finalMatches.length}`);

    // 收集晉級隊伍ID
    const qualifiedTeamIds: number[] = [];
    
    // 如果只需要1個晉級隊伍，取冠軍
    if (advancementCount === 1) {
      const championMatch = finalMatches[0]; // 假設決賽只有一場
      if (championMatch?.winner_team_id) {
        qualifiedTeamIds.push(championMatch.winner_team_id);
      }
    } else {
      // 如果需要多個晉級隊伍，取決賽和季軍賽的勝者
      finalMatches.forEach(match => {
        if (match.winner_team_id) {
          qualifiedTeamIds.push(match.winner_team_id);
        }
      });
      
      // 如果還需要更多隊伍，從準決賽取
      if (qualifiedTeamIds.length < advancementCount && finalRound > 1) {
        const semifinalMatches = matches.filter(m => m.round === finalRound - 1);
        semifinalMatches.forEach(match => {
          if (match.winner_team_id && !qualifiedTeamIds.includes(match.winner_team_id)) {
            qualifiedTeamIds.push(match.winner_team_id);
          }
        });
      }
    }

    console.log(`🎯 晉級隊伍ID: ${qualifiedTeamIds}`);

    // 獲取隊伍詳細資料
    if (qualifiedTeamIds.length > 0) {
      const { data: teams, error: teamError } = await supabase
        .from('contest_team')
        .select('contest_team_id, team_name')
        .in('contest_team_id', qualifiedTeamIds);

      if (teamError) {
        console.error('獲取隊伍詳細資料失敗:', teamError);
        throw teamError;
      }

      const qualifiedTeams = teams?.slice(0, advancementCount).map((team, index) => ({
        contest_team_id: team.contest_team_id,
        team_name: team.team_name,
        rank: index + 1,
        qualified_at: new Date().toISOString()
      })) || [];

      console.log(`✅ 淘汰賽晉級隊伍:`, qualifiedTeams);
      return qualifiedTeams;
    }

    return [];
  } catch (err) {
    console.error('❌ 計算淘汰賽晉級隊伍失敗:', err);
    return [];
  }
};

/**
 * 與 ContestResultsPage 相同的排序邏輯（用於晉級計算）
 */
const sortTeamsByHeadToHeadAdvancement = (teams: any[]) => {
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
  
  const hasCircularWinning = checkCircularWinningAdvancement(teams);
  
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

/**
 * 檢查循環勝負關係（與 ContestResultsPage 相同邏輯）
 */
const checkCircularWinningAdvancement = (teams: any[]) => {
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
