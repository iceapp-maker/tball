import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';

interface ContestData {
  contest_id: string;
  contest_name: string;
  contest_status: string;
  contest_type: string;
  match_mode: string;
  parent_contest_id: string | null;
  expected_teams?: number; // 預期隊伍數
  advancement_rules?: {
    groups: number;
    advances: number;
  };
  advancement_team_count?: number; // 舊版本兼容性
  group_count?: number; // 舊版本兼容性
  bracket_structure?: any;
  [key: string]: any;
}

interface Contest extends ContestData {
  children: Contest[];
}

const ContestControlPage: React.FC = () => {
  const navigate = useNavigate();
  const [contests, setContests] = useState<Contest[]>([]);
  const [teamCounts, setTeamCounts] = useState<{[key: string]: number}>({});
  const [contestsWithScores, setContestsWithScores] = useState<{[key: string]: boolean}>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [generatingSchedule, setGeneratingSchedule] = useState(false);
  const [generatingContestId, setGeneratingContestId] = useState<string | null>(null);
  const [expandedContests, setExpandedContests] = useState<Set<string>>(new Set());

  const toggleExpand = (contestId: string) => {
    setExpandedContests((prev: Set<string>) => {
      const newSet = new Set(prev);
      if (newSet.has(contestId)) {
        newSet.delete(contestId);
      } else {
        newSet.add(contestId);
      }
      return newSet;
    });
  };

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

  // 處理查看賽程按鈕點擊
  const handleViewSchedule = (contestId: string, contestType?: string, matchMode?: string) => {
    if (contestType === 'league_parent') {
      navigate(`/contest/${contestId}/custom`);
    } else if (matchMode === 'round_robin') {
      // 循環賽跳轉到戰況室（與一般單循環賽保持一致）
      navigate(`/contest/${contestId}/battleroom`);
    } else {
      // 淘汰賽跳轉到淘汰賽圖表
      navigate(`/contest/${contestId}/bracket`);
    }
  };

  const checkAllScoresFilled = async (contestId: string) => {
    try {
      // 檢查所有比賽是否都有獲勝者
      const { data: matches, error: matchError } = await supabase
        .from('contest_match')
        .select('winner_team_id')
        .eq('contest_id', contestId);

      if (matchError) throw matchError;
      
      // 如果沒有比賽記錄，返回 false
      if (!matches || matches.length === 0) {
        return false;
      }
      
      // 檢查是否所有比賽都有獲勝者
      const allMatchesCompleted = matches.every(match => match.winner_team_id !== null);
      
      if (!allMatchesCompleted) {
        return false;
      }
      
      // 對於淘汰賽，還需要檢查是否只剩下一支隊伍（冠軍）
      const { data: contestData, error: contestError } = await supabase
        .from('contest')
        .select('match_mode')
        .eq('contest_id', contestId)
        .single();
        
      if (contestError) throw contestError;
      
      if (contestData.match_mode === 'elimination') {
        // 淘汰賽：檢查是否產生了最終冠軍
        // 獲取所有獲勝者
        const winners = matches.map(match => match.winner_team_id);
        const uniqueWinners = [...new Set(winners)];
        
        // 檢查是否有隊伍在最後一輪獲勝（即沒有在後續比賽中作為參賽者出現）
        const { data: allMatches, error: allMatchError } = await supabase
          .from('contest_match')
          .select('team1_id, team2_id, winner_team_id')
          .eq('contest_id', contestId);
          
        if (allMatchError) throw allMatchError;
        
        // 找出所有參賽隊伍
        const allParticipants = new Set();
        allMatches.forEach(match => {
          allParticipants.add(match.team1_id);
          allParticipants.add(match.team2_id);
        });
        
        // 找出最終冠軍（獲勝但不再參加後續比賽的隊伍）
        const finalWinners = uniqueWinners.filter(winnerId => {
          // 檢查這個獲勝者是否還有後續比賽
          const hasSubsequentMatch = allMatches.some(match => 
            (match.team1_id === winnerId || match.team2_id === winnerId) && 
            match.winner_team_id === null
          );
          return !hasSubsequentMatch;
        });
        
        // 淘汰賽應該只有一個最終冠軍
        return finalWinners.length === 1;
      } else {
        // 循環賽：所有比賽都完成即可
        return true;
      }
      
    } catch (err) {
      console.error('檢查比賽完成狀態時出錯:', err);
      return false;
    }
  };

  // 🆕 新增：計算循環賽晉級隊伍（與 ContestResultsPage 相同邏輯）
// 🆕 新增：計算循環賽晉級隊伍（與 ContestResultsPage 相同邏輯）
const calculateRoundRobinQualifiedTeams = async (contestId: string, advancementCount: number) => {
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

  const handleFinishContest = async (contestId: string) => {
    try {
      // 1. 獲取比賽資訊，檢查是否為子賽事
      const { data: contestInfo, error: contestError } = await supabase
        .from('contest')
        .select('parent_contest_id, match_mode, advancement_rules')
        .eq('contest_id', contestId)
        .single();

      if (contestError) {
        console.error('獲取比賽資訊失敗:', contestError);
        throw contestError;
      }

      // 🆕 2. 如果是子賽事，先計算並記錄晉級隊伍到 advancement_rules
      console.log('🚨 DEBUG: 檢查是否為子賽事，parent_contest_id:', contestInfo.parent_contest_id);
      if (contestInfo.parent_contest_id) {
        try {
          console.log(`🔍 開始計算子賽事 ${contestId} 的晉級隊伍...`);
          console.log('📊 比賽資訊:', contestInfo);
          
          // 獲取晉級隊伍數量
          const advancementCount = contestInfo.advancement_rules?.advancement_count || 
                                 contestInfo.advancement_rules?.advances || 
                                 contestInfo.advancement_rules?.advancement_team_count || 1;
          
          console.log(`🎯 晉級隊伍數量: ${advancementCount}`);

          let qualifiedTeams: any[] = [];

          if (contestInfo.match_mode === 'round_robin') {
            console.log('🔄 循環賽模式，開始計算晉級隊伍...');
            // 使用新的計算函數（與 ContestResultsPage 相同邏輯）
            qualifiedTeams = await calculateRoundRobinQualifiedTeams(contestId, advancementCount);
          } else {
            console.log('🏆 淘汰賽模式，開始計算晉級隊伍...');
            // 淘汰賽邏輯（暫時保持原有）
            qualifiedTeams = await getEliminationQualifiedTeams(contestId, advancementCount);
          }

          console.log(`✅ 計算完成，晉級隊伍:`, qualifiedTeams);

          if (qualifiedTeams.length > 0) {
            // 🆕 更新 advancement_rules，保留原有內容並新增 qualified_teams
            const updatedAdvancementRules = {
              ...contestInfo.advancement_rules,
              qualified_teams: qualifiedTeams
            };

            console.log('💾 準備更新資料庫，新的 advancement_rules:', updatedAdvancementRules);

            const { error: updateRulesError } = await supabase
              .from('contest')
              .update({ advancement_rules: updatedAdvancementRules })
              .eq('contest_id', contestId);

            if (updateRulesError) {
              console.error('❌ 更新晉級隊伍記錄失敗:', updateRulesError);
              throw updateRulesError;
            }

            console.log(`✅ 子賽事 ${contestId} 晉級隊伍已成功記錄到資料庫!`);
          } else {
            console.warn('⚠️ 沒有計算出晉級隊伍，可能是比賽數據不完整');
          }
        } catch (qualifiedError) {
          console.error('❌ 計算並記錄晉級隊伍失敗:', qualifiedError);
          alert('警告：比賽結束成功，但晉級隊伍記錄失敗，請手動檢查控制台錯誤訊息');
        }
      }

      // 3. 更新比賽狀態為已結束
      const { error: updateError } = await supabase
        .from('contest')
        .update({ contest_status: 'finished' })
        .eq('contest_id', contestId);

      if (updateError) {
        console.error('更新比賽狀態失敗:', updateError);
        throw updateError;
      }

      // 4. 如果是子賽事，處理晉級隊伍的分組邏輯（移除晉級隊伍從 contest_group_assignment）
      if (contestInfo.parent_contest_id) {
        try {
          await handleSubContestAdvancement(contestId, contestInfo);
          console.log('晉級處理完成');
        } catch (advancementError) {
          console.error('處理晉級失敗，但比賽狀態已更新:', advancementError);
        }
      }

      setContests(contests.map((contest: { contest_id: string, contest_status: string }) => 
        contest.contest_id === contestId 
          ? { ...contest, contest_status: 'finished' } 
          : contest
      ));
      
      alert('比賽已成功結束！晉級隊伍已記錄。');
    } catch (err) {
      console.error('更新比賽狀態時出錯:', err);
      alert('更新比賽狀態失敗，請稍後再試！');
    }
  };

  // 處理子賽事晉級邏輯
  const handleSubContestAdvancement = async (contestId: string, contestInfo: any) => {
    try {
      console.log('處理子賽事晉級邏輯:', contestId, contestInfo);
      
      // 獲取晉級隊伍數量
      let advancementCount = 1; // 預設晉級1隊
      console.log('advancement_rules 完整內容:', contestInfo.advancement_rules);
      
      if (contestInfo.advancement_rules?.advancement_count) {
        advancementCount = contestInfo.advancement_rules.advancement_count;
        console.log('從 advancement_rules.advancement_count 獲取:', advancementCount);
      } else if (contestInfo.advancement_rules?.advances) {
        advancementCount = contestInfo.advancement_rules.advances;
        console.log('從 advancement_rules.advances 獲取:', advancementCount);
      } else if (contestInfo.advancement_rules?.advancement_team_count) {
        advancementCount = contestInfo.advancement_rules.advancement_team_count;
        console.log('從 advancement_rules.advancement_team_count 獲取:', advancementCount);
      } else {
        console.log('使用預設晉級數量:', advancementCount);
      }
      
      // 先獲取該子賽事的實際參賽隊伍數量
      const { data: participatingTeams, error: teamCountError } = await supabase
        .from('contest_group_assignment')
        .select('contest_team_id')
        .eq('group_contest_id', contestId);

      if (teamCountError) throw teamCountError;
      
      const actualTeamCount = participatingTeams?.length || 0;
      console.log('子賽事實際參賽隊伍數:', actualTeamCount);
      
      // 晉級數量不能超過實際參賽隊伍數，且至少要有1隊被淘汰
      if (advancementCount >= actualTeamCount) {
        console.warn(`晉級數量 ${advancementCount} 超過或等於參賽隊伍數 ${actualTeamCount}，調整為 ${actualTeamCount - 1}`);
        advancementCount = Math.max(1, actualTeamCount - 1); // 確保至少有1隊被淘汰
      }
      
      console.log('調整後的晉級隊伍數量:', advancementCount);

      let qualifiedTeams: any[] = [];

      if (contestInfo.match_mode === 'round_robin') {
        console.log('處理循環賽晉級');
        // 循環賽：根據積分排名決定晉級隊伍
        qualifiedTeams = await getRoundRobinQualifiedTeams(contestId, advancementCount);
      } else {
        console.log('處理淘汰賽晉級');
        // 淘汰賽：獲取冠軍隊伍
        qualifiedTeams = await getEliminationQualifiedTeams(contestId, advancementCount);
      }

      console.log('計算出的晉級隊伍:', qualifiedTeams);

      // 正確邏輯：將晉級隊伍從 contest_group_assignment 表中移除，讓它們回到待排清單
      if (qualifiedTeams.length > 0) {
        const qualifiedTeamIds = qualifiedTeams.map(team => team.contest_team_id);
        console.log('晉級隊伍ID（應從表中移除）:', qualifiedTeamIds);
        
        // 將晉級隊伍從 contest_group_assignment 表中移除
        const { data: deletedData, error: removeError } = await supabase
          .from('contest_group_assignment')
          .delete()
          .eq('group_contest_id', contestId)
          .in('contest_team_id', qualifiedTeamIds)
          .select();

        console.log('移除晉級隊伍結果:', { deletedData, removeError });

        if (removeError) {
          console.error('移除晉級隊伍失敗:', removeError);
          throw removeError;
        } else {
          console.log('成功將晉級隊伍從 contest_group_assignment 表中移除，數量:', deletedData?.length || 0);
          console.log('成功移除的晉級隊伍:', deletedData);
          
          // 驗證結果：應該只剩下被淘汰隊伍
          const { data: remainingAssignments } = await supabase
            .from('contest_group_assignment')
            .select('*')
            .eq('group_contest_id', contestId);
          
          console.log('剩餘的分配記錄（應該是被淘汰隊伍）:', remainingAssignments);
        }
      } else {
        console.log('沒有找到晉級隊伍');
      }
    } catch (error) {
      console.error('處理子賽事晉級邏輯失敗:', error);
      throw error;
    }
  };

  // 獲取循環賽晉級隊伍
  const getRoundRobinQualifiedTeams = async (contestId: string, advancementCount: number) => {
    // 獲取比賽記錄
    const { data: matches, error: matchError } = await supabase
      .from('contest_match')
      .select('match_id, team1_id, team2_id, winner_team_id')
      .eq('contest_id', contestId);

    if (matchError) throw matchError;
    console.log('比賽記錄:', matches);

    // 先獲取該子賽事的所有參賽隊伍
    const { data: assignments, error: assignmentError } = await supabase
      .from('contest_group_assignment')
      .select('contest_team_id')
      .eq('group_contest_id', contestId);

    if (assignmentError) throw assignmentError;
    console.log('子賽事參賽隊伍:', assignments);

    // 獲取比賽詳情（每局勝負）
    const matchIds = matches?.map(match => match.match_id) || [];
    const { data: matchDetails, error: detailError } = await supabase
      .from('contest_match_detail')
      .select('match_id, winner_team_id')
      .in('match_id', matchIds);

    if (detailError) throw detailError;
    console.log('比賽詳情記錄:', matchDetails);

    // 使用與比分表相同的排名邏輯
    const teamResults: {[teamId: number]: {
      teamId: number,
      wins: number,
      matchResults: Record<number, string>,
      winningGames: number
    }} = {};

    // 初始化所有參賽隊伍的統計
    assignments?.forEach(assignment => {
      teamResults[assignment.contest_team_id] = {
        teamId: assignment.contest_team_id,
        wins: 0,
        matchResults: {},
        winningGames: 0
      };
    });

    // 計算每場比賽的勝負和勝局數
    matches?.forEach(match => {
      const team1Id = match.team1_id;
      const team2Id = match.team2_id;
      
      if (!team1Id || !team2Id) return;
      
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
      const reverseScore = `${team2Wins}:${team1Wins}`;
      
      if (teamResults[team1Id]) {
        teamResults[team1Id].matchResults[team2Id] = scoreStr;
        teamResults[team1Id].winningGames += team1Wins;
        if (team1Wins > team2Wins) {
          teamResults[team1Id].wins += 1;
        }
      }
      
      if (teamResults[team2Id]) {
        teamResults[team2Id].matchResults[team1Id] = reverseScore;
        teamResults[team2Id].winningGames += team2Wins;
        if (team2Wins > team1Wins) {
          teamResults[team2Id].wins += 1;
        }
      }
    });

    console.log('隊伍統計結果:', teamResults);

    // 使用與比分表相同的排序邏輯
    const teamsArray = Object.values(teamResults);
    
    // 按勝場數分組
    const teamsByWins: Record<number, typeof teamsArray> = {};
    teamsArray.forEach(team => {
      if (!teamsByWins[team.wins]) {
        teamsByWins[team.wins] = [];
      }
      teamsByWins[team.wins].push(team);
    });

    const sortedTeams: typeof teamsArray = [];
    Object.keys(teamsByWins)
      .map(Number)
      .sort((a, b) => b - a)
      .forEach(wins => {
        const teamsWithSameWins = teamsByWins[wins];
        
        if (teamsWithSameWins.length === 1) {
          sortedTeams.push(teamsWithSameWins[0]);
          return;
        }
        
        // 使用與比分表相同的排序邏輯處理相同勝場數的隊伍
        const sortedGroup = sortTeamsByHeadToHeadAdvancement(teamsWithSameWins);
        sortedTeams.push(...sortedGroup);
      });

    // 取前N名晉級隊伍
    const qualifiedTeams = sortedTeams
      .slice(0, advancementCount)
      .map(team => ({ contest_team_id: team.teamId }));

    console.log('排序後的晉級隊伍:', qualifiedTeams);
    return qualifiedTeams;
  };

  // 與 ContestResultsPage 相同的排序邏輯（用於晉級計算）
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

  // 檢查循環勝負關係（與 ContestResultsPage 相同邏輯）
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

  // 獲取淘汰賽晉級隊伍
  const getEliminationQualifiedTeams = async (contestId: string, advancementCount: number) => {
    // 獲取最終獲勝者
    const { data: matches, error: matchError } = await supabase
      .from('contest_match')
      .select('team1_id, team2_id, winner_team_id')
      .eq('contest_id', contestId);

    if (matchError) throw matchError;

    // 找出冠軍（獲勝但不再參加後續比賽的隊伍）
    const winners = matches?.map(match => match.winner_team_id).filter(Boolean) || [];
    const uniqueWinners = [...new Set(winners)];
    
    const finalWinners = uniqueWinners.filter(winnerId => {
      const hasSubsequentMatch = matches?.some(match => 
        (match.team1_id === winnerId || match.team2_id === winnerId) && 
        match.winner_team_id === null
      );
      return !hasSubsequentMatch;
    });

    return finalWinners.slice(0, advancementCount).map(teamId => ({ contest_team_id: teamId }));
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

      const contestMap = new Map<string, Contest>();
      const rootContests: Contest[] = [];

      // First pass: create a map of all contests and initialize children array
      ((contestsData as ContestData[]) || []).forEach(contest => {
        contestMap.set(contest.contest_id, { ...contest, children: [] });
      });

      // Second pass: link children to their parents
      for (const contest of contestMap.values()) {
        if (contest.parent_contest_id) {
          const parent = contestMap.get(contest.parent_contest_id);
          if (parent) {
            parent.children.push(contest);
          } else {
            // Orphaned child, treat as root
            rootContests.push(contest);
          }
        } else {
          // No parent_id, it's a root
          rootContests.push(contest);
        }
      }
      
      // Sort children by name for consistent ordering
      for (const contest of rootContests) {
        if (contest.children.length > 0) {
          contest.children.sort((a: any, b: any) => a.contest_name.localeCompare(b.contest_name));
        }
      }

      setContests(rootContests);
      console.log('[fetchContests] 處理後的巢狀比賽資料:', rootContests);
      console.log('[fetchContests] 當前使用者團隊名稱:', currentUserTeamName);

      // 獲取每個比賽的隊伍數量
      const counts: {[key: string]: number} = {};
      for (const contest of contestsData || []) {
        let count = 0;
        
        if (contest.parent_contest_id) {
          // 這是子賽事，優先使用 expected_teams 欄位（原始參賽隊伍數）
          if (contest.expected_teams && contest.expected_teams > 0) {
            // 使用 expected_teams 欄位的值
            count = contest.expected_teams;
            console.log(`[fetchContests] 子賽事 contest_id=${contest.contest_id} 使用 expected_teams:`, count);
          } else {
            // 如果 expected_teams 未設定，才從 contest_group_assignment 獲取並初始化
            const { count: groupTeamCount, error: groupCountError } = await supabase
              .from('contest_group_assignment')
              .select('assignment_id', { count: 'exact' })
              .eq('group_contest_id', contest.contest_id);

            if (groupCountError) throw groupCountError;
            count = groupTeamCount || 0;
            console.log(`[fetchContests] 子賽事 contest_id=${contest.contest_id} 初始化隊伍數:`, count);
            
            // 初始化 expected_teams 欄位
            if (count > 0) {
              console.log(`[fetchContests] 初始化子賽事 ${contest.contest_id} 的 expected_teams 為 ${count}`);
              await supabase
                .from('contest')
                .update({ expected_teams: count })
                .eq('contest_id', contest.contest_id);
            }
          }
        } else {
          // 這是主賽事
          if (contest.expected_teams && contest.expected_teams > 0) {
            // 優先使用 expected_teams 欄位
            count = contest.expected_teams;
            console.log(`[fetchContests] 主賽事 contest_id=${contest.contest_id} 使用 expected_teams:`, count);
          } else {
            // 從 contest_team 獲取隊伍數
            const { count: mainTeamCount, error: mainCountError } = await supabase
              .from('contest_team')
              .select('contest_team_id', { count: 'exact' })
              .eq('contest_id', contest.contest_id);

            if (mainCountError) throw mainCountError;
            count = mainTeamCount || 0;
            console.log(`[fetchContests] 主賽事 contest_id=${contest.contest_id} 查到實際隊伍數:`, count);
          }
        }
        counts[contest.contest_id] = count;
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
      let teamsData;
      
      if (contestData.parent_contest_id) {
        // 這是子賽事，從 contest_group_assignment 獲取隊伍
        const { data: groupAssignments, error: groupError } = await supabase
          .from('contest_group_assignment')
          .select('contest_team_id')
          .eq('group_contest_id', contestId);
        
        if (groupError) throw groupError;
        
        if (!groupAssignments || groupAssignments.length === 0) {
          throw new Error('子賽事尚未分配隊伍');
        }
        
        // 獲取隊伍詳細資料
        const teamIds = groupAssignments.map(a => a.contest_team_id);
        const { data: teamDetails, error: teamError } = await supabase
          .from('contest_team')
          .select('*')
          .in('contest_team_id', teamIds);
        
        if (teamError) throw teamError;
        teamsData = teamDetails;
      } else {
        // 這是主賽事，從 contest_team 獲取隊伍
        const { data: mainTeamsData, error: mainError } = await supabase
          .from('contest_team')
          .select('*')
          .eq('contest_id', contestId);
        
        if (mainError) throw mainError;
        teamsData = mainTeamsData;
      }

      if (!teamsData || teamsData.length < 2) {
        throw new Error('參賽隊伍不足，至少需要2支隊伍');
      }

      // 3. 根據賽制類型產生對戰組合
      let matches;
      if (contestData.match_mode === 'round_robin') {
        matches = generateImprovedRoundRobinMatches(teamsData, contestData.table_count || 1, contestId);
      } else {
        // 當 match_mode 不是 'round_robin' 時，一律視為 'elimination'
        matches = generateEliminationMatches(teamsData, contestData.table_count || 1, contestId);
      }

      // 4. 將對戰組合寫入資料庫
      const { data: matchesData, error: matchesError } = await supabase
        .from('contest_match')
        .insert(matches)
        .select();

      if (matchesError) throw matchesError;

      // 5. 為每場比賽產生對戰詳情
      if (matchesData) {
        const allMatchDetails = [];
        
        // 先準備所有 match_detail 資料
        for (const match of matchesData) {
          // 對於子賽事，需要從父賽事獲取 total_points
          let totalPoints = contestData.total_points;
          
          // 如果是子賽事且 total_points 未設定，從父賽事獲取
          if (contestData.parent_contest_id && (!totalPoints || totalPoints <= 0)) {
            console.log('子賽事的 total_points 未設定，嘗試從父賽事獲取...');
            const { data: parentData, error: parentError } = await supabase
              .from('contest')
              .select('total_points, points_config')
              .eq('contest_id', contestData.parent_contest_id)
              .single();
            
            if (!parentError && parentData) {
              totalPoints = parentData.total_points;
              // 同時更新 points_config
              if (!contestData.points_config && parentData.points_config) {
                contestData.points_config = parentData.points_config;
              }
              console.log(`從父賽事獲取 total_points: ${totalPoints}`);
            }
          }
          
          // 確保 total_points 至少為 1
          totalPoints = totalPoints && totalPoints > 0 ? totalPoints : 1;
          
          console.log(`比賽 ${match.match_id} 的最終 total_points: ${totalPoints}`);
          
          for (let i = 0; i < totalPoints; i++) {
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
            allMatchDetails.push(matchDetail);
          }
        }

        // 批量插入所有 match_detail 資料
        console.log(`準備插入 ${allMatchDetails.length} 筆 contest_match_detail 資料`);
        const { data: insertedDetails, error: detailError } = await supabase
          .from('contest_match_detail')
          .insert(allMatchDetails)
          .select();

        if (detailError) {
          console.error('新增比賽詳情失敗:', detailError);
          console.error('失敗的資料:', allMatchDetails);
          throw new Error(`新增比賽詳情失敗: ${detailError.message}`);
        }

        console.log(`成功插入 ${insertedDetails?.length || 0} 筆 contest_match_detail 資料`);
      }

      // 🎯 成功判定：檢查 contest_match 是否有該 contest_id 的資料
      const { data: verifyMatchData, error: verifyMatchError } = await supabase
        .from('contest_match')
        .select('contest_id')
        .eq('contest_id', contestId)
        .limit(1);

      if (verifyMatchError) throw verifyMatchError;

      // 檢查 contest_match_detail 是否有資料
      const { data: verifyDetailData, error: verifyDetailError } = await supabase
        .from('contest_match_detail')
        .select('contest_id')
        .eq('contest_id', contestId)
        .limit(1);

      if (verifyDetailError) throw verifyDetailError;

      // ✅ 如果 contest_match 和 contest_match_detail 都有資料，表示成功
      if (verifyMatchData && verifyMatchData.length > 0 && verifyDetailData && verifyDetailData.length > 0) {
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
  const generateImprovedRoundRobinMatches = (teams: any[], tableCount: number, targetContestId: string) => {
    const matches = [];
    let sequence = 1;
    
    // 創建所有可能的對戰組合
    const allPairs = [];
    for (let i = 0; i < teams.length; i++) {
      for (let j = i + 1; j < teams.length; j++) {
        // 確保 ID 是數字類型
        const team1Id = typeof teams[i].contest_team_id === 'string' ? parseInt(teams[i].contest_team_id) : teams[i].contest_team_id;
        const team2Id = typeof teams[j].contest_team_id === 'string' ? parseInt(teams[j].contest_team_id) : teams[j].contest_team_id;
        
        allPairs.push({
          team1Id: team1Id,
          team2Id: team2Id,
          contestId: targetContestId
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
  const generateEliminationMatches = (teams: any[], tableCount: number, targetContestId: string) => {
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
      
      matches.push({
        contest_id: targetContestId,
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
  const renderStatusBadge = (status: string, contestId: string, contestType: string) => {
    let color = '';
    let text = '';
    
    // 根據比賽類型顯示不同的狀態文字
    if (contestType === 'league_child') {
      // 子系比賽的狀態顯示
      switch (status) {
        case 'recruiting':
          color = 'bg-orange-500';
          text = '待分配隊伍'; // 子系比賽應顯示為待分配隊伍而非人員招募中
          break;
        case 'WaitMatchForm':
          color = 'bg-orange-500';
          text = '待管理員產生對戰表';
          break;
        case 'lineup_arrangement':
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
    } else if (contestType === 'league_parent') {
      // 混合賽主賽事的狀態顯示
      switch (status) {
        case 'recruiting':
          color = 'bg-blue-500';
          text = '人員招募中';
          break;
        case 'WaitMatchForm':
          color = 'bg-purple-500';
          text = '待配置子賽事'; // 主賽事不需要產生對戰表，而是需要配置子賽事
          break;
        case 'lineup_arrangement':
          color = 'bg-yellow-500';
          text = '子賽事進行中';
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
    } else {
      // 一般比賽的狀態顯示
      switch (status) {
        case 'recruiting':
          color = 'bg-blue-500';
          text = '人員招募中';
          break;
        case 'WaitMatchForm':
          color = 'bg-orange-500';
          text = '待管理員產生對戰表';
          break;
        case 'lineup_arrangement':
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
    }
    
    return (
      <span className={`${color} text-white px-2 py-1 rounded text-xs`}>
        {text}
      </span>
    );
  };

  return (
    <>
      <div className="max-w-6xl mx-auto mt-8 p-6 bg-white rounded shadow">
        <div className="sm:flex sm:items-center">
          <div className="sm:flex-auto">
            <h1 className="text-xl font-semibold text-gray-900">賽事控制台</h1>
            <p className="mt-2 text-sm text-gray-700">
              管理您的所有賽事，包括編輯、查看報名、生成賽程等。
            </p>
          </div>
          <div className="mt-4 sm:mt-0 sm:ml-16 sm:flex-none">
            <button
              type="button"
              onClick={() => navigate('/contest/create')}
              className="inline-flex items-center justify-center rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 sm:w-auto"
            >
              新增賽事
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto mt-8 flex flex-col">
        <div className="-my-2 -mx-4 overflow-x-auto sm:-mx-6 lg:-mx-8">
          <div className="inline-block min-w-full py-2 align-middle md:px-6 lg:px-8">
            <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 md:rounded-lg">
              <table className="min-w-full divide-y divide-gray-300">
                <thead className="bg-gray-50">
                  <tr>
                    <th scope="col" className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900 sm:pl-6">比賽名稱</th>
                    <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">狀態</th>
                    <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">類型</th>
                    <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">賽制</th>
                    <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">隊伍數</th>
                    <th scope="col" className="relative py-3.5 pl-3 pr-4 sm:pr-6">
                      <span className="sr-only">操作</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {contests.map((contest) => (
                    <React.Fragment key={contest.contest_id}>
                      <tr>
                        <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-gray-900 sm:pl-6">
                          <div className="flex items-center">
                            {contest.children && contest.children.length > 0 ? (
                              <button onClick={() => toggleExpand(contest.contest_id)} className="mr-2 text-indigo-600 hover:text-indigo-900 w-6 text-center font-bold">
                                {expandedContests.has(contest.contest_id) ? '−' : '+'}
                              </button>
                            ) : (
                              <div className="w-8"></div> // Placeholder for alignment
                            )}
                            {contest.contest_name}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">{renderStatusBadge(contest.contest_status, contest.contest_id, contest.contest_type)}</td>
                        <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">{contest.contest_type === 'league_parent' ? '主聯賽' : contest.contest_type === 'league_child' ? '子分組' : '一般賽'}</td>
                        <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">{contest.match_mode === 'round_robin' ? '循環賽' : '淘汰賽'}</td>
                        <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">{teamCounts[contest.contest_id] || 0}</td>
                        <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
                          <div className="flex items-center justify-end space-x-2">
                            {(() => {
                              // 多組競賽主賽事暫不顯示額外按鈕
                              if (contest.contest_type === 'league_parent') {
                                return null;
                              }

                              switch (contest.contest_status) {
                                case 'signup':
                                case 'recruiting':
                                  if (contest.contest_type === 'group_stage' || contest.parent_contest_id) {
                                    return (
                                      <button
                                        onClick={() => navigate(`/contest/${contest.contest_id}/manage-teams`)}
                                        className="bg-green-500 text-white px-3 py-1 rounded hover:bg-green-600 text-sm"
                                      >
                                        組況查詢
                                      </button>
                                    );
                                  }
                                  // 對於混合賽主賽事，不顯示產生對戰表按鈕，因為對戰表應該在子賽事中產生
                                  if (contest.contest_type === 'league_parent') {
                                    return (
                                      <button onClick={() => navigate(`/contest/edit/${contest.contest_id}`)} className="text-indigo-600 hover:text-indigo-900">編輯</button>
                                    );
                                  }
                                  return (
                                    <>
                                      <button onClick={() => navigate(`/contest/edit/${contest.contest_id}`)} className="text-indigo-600 hover:text-indigo-900">編輯</button>
                                      <button
                                        onClick={() => handleGenerateSchedule(contest.contest_id)}
                                        disabled={generatingContestId === contest.contest_id}
                                        className="bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600 text-sm disabled:bg-gray-400"
                                      >
                                        {generatingContestId === contest.contest_id ? '產生中...' : '產生對戰表'}
                                      </button>
                                    </>
                                  );
                                case 'lineup_arrangement':
                                  return (
                                    <button onClick={() => navigate(`/contest/${contest.contest_id}/lineup-status`)} className="bg-yellow-500 text-white px-3 py-1 rounded hover:bg-yellow-600 text-sm">查看名單狀態</button>
                                  );
                                case 'ongoing':
                                  return (
                                    <>
                                      <button onClick={() => handleViewSchedule(contest.contest_id, contest.contest_type, contest.match_mode)} className="bg-cyan-500 text-white px-3 py-1 rounded hover:bg-cyan-600 text-sm">查看賽程</button>
                                      {contestsWithScores[contest.contest_id] && (
                                        <button
                                          onClick={() => handleFinishContest(contest.contest_id)}
                                          className="bg-green-600 hover:bg-green-700 text-white px-2 py-1 rounded text-sm"
                                        >
                                          確認比賽結束
                                        </button>
                                      )}
                                    </>
                                  );
                                case 'finished':
                                  return (
                                    <button onClick={() => handleViewSchedule(contest.contest_id, contest.contest_type, contest.match_mode)} className="text-gray-600 hover:text-gray-900">查看賽程</button>
                                  );
                                default:
                                  return null;
                              }
                            })()}
                            {contest.match_mode !== 'round_robin' && (
                              <button
                                onClick={() => handleViewSchedule(contest.contest_id, contest.contest_type, contest.match_mode)}
                                className="bg-purple-600 hover:bg-purple-700 text-white px-2 py-1 rounded text-sm"
                              >
                                {contest.contest_type === 'league_parent' ? '混合賽管理' : '淘汰賽圖表'}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {expandedContests.has(contest.contest_id) && contest.children.map((child: Contest) => (
                        <tr key={child.contest_id} className="bg-gray-50">
                          <td className="whitespace-nowrap py-4 pl-12 pr-3 text-sm text-gray-800 sm:pl-12">{child.contest_name}</td>
                          <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">{renderStatusBadge(child.contest_status, child.contest_id, child.contest_type)}</td>
                          <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">{child.contest_type === 'league_parent' ? '主聯賽' : child.contest_type === 'league_child' ? '子分組' : '一般賽'}</td>
                          <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">{child.match_mode === 'round_robin' ? '循環賽' : '淘汰賽'}</td>
                          <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">{teamCounts[child.contest_id] || 0}</td>
                          <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
                            <div className="flex items-center justify-end space-x-2">
                              {(() => {
                                // 多組競賽主賽事暫不顯示額外按鈕
                                if (child.contest_type === 'league_parent') {
                                  return null;
                                }
                                
                                switch (child.contest_status) {
                                  case 'signup':
                                  case 'recruiting':
                                    // 檢查子賽事是否已分配隊伍
                                    const hasTeams = teamCounts[child.contest_id] && teamCounts[child.contest_id] > 0;
                                    
                                    if (child.contest_type === 'group_stage' || (child.parent_contest_id && !hasTeams)) {
                                      return (
                                        <button
                                          onClick={() => navigate(`/contest/${child.contest_id}/manage-teams`)}
                                          className="bg-green-500 text-white px-3 py-1 rounded hover:bg-green-600 text-sm"
                                        >
                                          組況查詢
                                        </button>
                                      );
                                    }
                                    return (
                                      <>
                                        <button onClick={() => navigate(`/contest/edit/${child.contest_id}`)} className="text-indigo-600 hover:text-indigo-900">編輯</button>
                                        {/* 只有循環賽子賽事才顯示產生對戰表按鈕，淘汰賽子賽事不需要 */}
                                        {child.match_mode === 'round_robin' && (
                                          <button
                                            onClick={() => handleGenerateSchedule(child.contest_id)}
                                            disabled={generatingContestId === child.contest_id}
                                            className="bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600 text-sm disabled:bg-gray-400"
                                          >
                                            {generatingContestId === child.contest_id ? '產生中...' : '產生對戰表'}
                                          </button>
                                        )}
                                      </>
                                    );
                                  case 'WaitMatchForm':
                                    return (
                                      <>
                                        <button onClick={() => navigate(`/contest/edit/${child.contest_id}`)} className="text-indigo-600 hover:text-indigo-900">編輯</button>
                                        {/* 只有循環賽子賽事才顯示產生對戰表按鈕，淘汰賽子賽事不需要 */}
                                        {child.match_mode === 'round_robin' && (
                                          <button
                                            onClick={() => handleGenerateSchedule(child.contest_id)}
                                            disabled={generatingContestId === child.contest_id}
                                            className="bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600 text-sm disabled:bg-gray-400"
                                          >
                                            {generatingContestId === child.contest_id ? '產生中...' : '產生對戰表'}
                                          </button>
                                        )}
                                      </>
                                    );
                                  case 'lineup_arrangement':
                                    return (
                                      <button onClick={() => navigate(`/contest/${child.contest_id}/lineup-status`)} className="bg-yellow-500 text-white px-3 py-1 rounded hover:bg-yellow-600 text-sm">查看名單狀態</button>
                                    );
                                  case 'ongoing':
                                    return (
                                      <>
                                        <button onClick={() => handleViewSchedule(child.contest_id, child.contest_type, child.match_mode)} className="bg-cyan-500 text-white px-3 py-1 rounded hover:bg-cyan-600 text-sm">查看賽程</button>
                                        {contestsWithScores[child.contest_id] && (
                                          <button
                                            onClick={() => handleFinishContest(child.contest_id)}
                                            className="bg-green-600 hover:bg-green-700 text-white px-2 py-1 rounded text-sm"
                                          >
                                            確認比賽結束
                                          </button>
                                        )}
                                      </>
                                    );
                                  case 'finished':
                                    return (
                                      <button onClick={() => handleViewSchedule(child.contest_id, child.contest_type, child.match_mode)} className="text-gray-600 hover:text-gray-900">查看賽程</button>
                                    );
                                  default:
                                    return null;
                                }
                              })()}
                              {child.match_mode !== 'round_robin' && (
                                <button
                                  onClick={() => handleViewSchedule(child.contest_id, child.contest_type, child.match_mode)}
                                  className="bg-purple-600 hover:bg-purple-700 text-white px-2 py-1 rounded text-sm"
                                >
                                  {child.contest_type === 'league_parent' ? '混合賽管理' : '淘汰賽圖表'}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 p-4 bg-yellow-50 border border-yellow-200 rounded">
        <h3 className="font-bold text-yellow-800 mb-2">說明</h3>
        <ul className="list-disc pl-5 text-sm text-yellow-700">
          <li>當比賽狀態為「待管理員執行產生對戰表」時，可以產生對戰表。</li>
          <li>循環賽：每隊都會與其他所有隊伍對戰一次。</li>
          <li>淘汰賽：輸一場就淘汰，優勝者晉級下一輪。</li>
          <li>產生對戰表後，將由隊長編排出賽名單。</li>
          <li>淘汰賽模式的比賽在任何階段都可以查看淘汰賽圖表。</li>
        </ul>
      </div>
    </>
  );
};

export default ContestControlPage;