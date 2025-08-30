import { supabase } from '../../supabaseClient';

export interface QualifiedTeam {
  contest_team_id: number;
  team_name: string;
  points?: number;
}

export const finishContest = async (contestId: string): Promise<boolean> => {
  try {
    console.log(`🚀 開始結束比賽: ${contestId}`);
    console.log(`當前時間: ${new Date().toISOString()}`);

    // 獲取比賽資訊
    const { data: contestInfo, error: contestError } = await supabase
      .from('contest')
      .select('*')
      .eq('contest_id', contestId)
      .single();

    if (contestError) {
      console.error('❌ 獲取比賽資訊失敗:', contestError);
      throw new Error(`獲取比賽資訊失敗: ${contestError.message}`);
    }

    if (!contestInfo) {
      throw new Error('找不到比賽資訊');
    }

    console.log('📋 比賽資訊:', {
      contest_id: contestInfo.contest_id,
      contest_name: contestInfo.contest_name,
      match_mode: contestInfo.match_mode,
      parent_contest_id: contestInfo.parent_contest_id,
      advancement_rules: contestInfo.advancement_rules
    });

    let qualifiedTeams: QualifiedTeam[] = [];

    // 根據比賽模式計算晉級隊伍
    try {
      if (contestInfo.match_mode === 'round_robin') {
        const advancementCount = contestInfo.advancement_rules?.advancement_count || 
                               contestInfo.advancement_rules?.advances || 
                               2;
        console.log(`🔄 循環賽模式，晉級隊伍數: ${advancementCount}`);
        qualifiedTeams = await getRoundRobinQualifiedTeams(contestId, advancementCount);
      } else if (contestInfo.match_mode === 'elimination') {
        const advancementCount = contestInfo.advancement_rules?.advancement_count || 
                                contestInfo.advancement_rules?.expected_output || 
                                1;
        console.log(`🏆 淘汰賽模式，晉級隊伍數: ${advancementCount}`);
        qualifiedTeams = await getEliminationQualifiedTeams(contestId, advancementCount);
      }
      
      console.log(`📊 計算出的晉級隊伍:`, qualifiedTeams);
    } catch (qualifiedError) {
      console.error('❌ 計算晉級隊伍失敗:', qualifiedError);
      throw new Error(`計算晉級隊伍失敗: ${qualifiedError.message}`);
    }

    // 更新比賽狀態為已完成
    try {
      const { error: updateError } = await supabase
        .from('contest')
        .update({ 
          contest_status: 'finished',
          advancement_rules: {
            ...contestInfo.advancement_rules,
            qualified_teams: qualifiedTeams
          }
        })
        .eq('contest_id', contestId);

      if (updateError) {
        console.error('❌ 更新比賽狀態失敗:', updateError);
        throw new Error(`更新比賽狀態失敗: ${updateError.message}`);
      }
      
      console.log('✅ 比賽狀態已更新為 finished');
    } catch (updateError) {
      console.error('❌ 更新比賽狀態時發生錯誤:', updateError);
      throw updateError;
    }

    // 如果是子賽事，處理晉級邏輯
    if (contestInfo.parent_contest_id) {
      try {
        console.log(`🔄 處理子賽事晉級邏輯...`);
        console.log(`📋 子賽事資訊: contestId=${contestId}, parentContestId=${contestInfo.parent_contest_id}`);
        console.log(`🏆 晉級隊伍數量: ${qualifiedTeams.length}`);
        
        await handleSubContestAdvancement(contestId, contestInfo.parent_contest_id, qualifiedTeams);
        console.log('✅ 子賽事晉級邏輯處理完成');
        
        // 🔧 新增：驗證處理結果
        console.log(`🔍 驗證處理結果...`);
        const { data: verifyData, error: verifyError } = await supabase
          .from('contest_group_assignment')
          .select('contest_team_id, team_name, status')
          .eq('main_contest_id', parseInt(contestInfo.parent_contest_id));
          
        if (!verifyError) {
          console.log(`📊 父賽事 ${contestInfo.parent_contest_id} 的 contest_group_assignment 記錄:`, verifyData);
        }
        
      } catch (advancementError) {
        console.error('❌ 處理子賽事晉級邏輯失敗:', advancementError);
        // 🔧 修正：子賽事晉級邏輯失敗應該拋出錯誤，因為這會影響待排清單
        throw new Error(`處理子賽事晉級邏輯失敗: ${advancementError.message}`);
      }
    }

    console.log(`✅ 比賽 ${contestId} 結束成功，${qualifiedTeams.length} 支隊伍晉級`);
    return true;

  } catch (error) {
    console.error('❌ 結束比賽失敗:', error);
    throw error;
  }
};

// 處理子賽事晉級邏輯
const handleSubContestAdvancement = async (
  contestId: string, 
  parentContestId: string, 
  qualifiedTeams: QualifiedTeam[]
) => {
  try {
    console.log(`🔄 處理子賽事 ${contestId} 的晉級邏輯...`);
    console.log(`📋 父賽事ID: ${parentContestId}`);
    console.log(`🏆 晉級隊伍:`, qualifiedTeams);

    // 驗證 contestId 是否為有效數字
    const contestIdNum = parseInt(contestId);
    if (isNaN(contestIdNum)) {
      throw new Error(`無效的子賽事ID: ${contestId}`);
    }

    // 🔧 修正邏輯：先獲取該子賽事的所有分配隊伍（從 contest_group_assignment 表）
    console.log(`🔍 查詢子賽事 ${contestIdNum} 的分配隊伍...`);
    const { data: assignedTeams, error: assignedError } = await supabase
      .from('contest_group_assignment')
      .select('contest_team_id, team_name')
      .eq('group_contest_id', contestIdNum);

    if (assignedError) {
      console.error('❌ 獲取子賽事分配隊伍失敗:', assignedError);
      throw new Error(`獲取子賽事分配隊伍失敗: ${assignedError.message}`);
    }

    console.log(`子賽事 ${contestId} 的所有分配隊伍:`, assignedTeams);

    if (!assignedTeams || assignedTeams.length === 0) {
      console.warn(`⚠️ 子賽事 ${contestId} 沒有分配隊伍記錄，跳過 contest_group_assignment 表更新`);
      return;
    }

    // 計算淘汰隊伍 = 所有分配隊伍 - 晉級隊伍
    const qualifiedTeamIds = new Set(qualifiedTeams.map(t => t.contest_team_id));
    console.log(`晉級隊伍ID集合:`, Array.from(qualifiedTeamIds));
    
    const eliminatedTeams = assignedTeams.filter(team => 
      !qualifiedTeamIds.has(team.contest_team_id)
    );
    
    console.log(`計算出的淘汰隊伍:`, eliminatedTeams);

    // 🆕 步驟1：刪除該子賽事的所有現有分配記錄
    console.log(`🗑️ 刪除子賽事 ${contestIdNum} 的所有現有分配記錄...`);
    const { error: deleteError } = await supabase
      .from('contest_group_assignment')
      .delete()
      .eq('group_contest_id', contestIdNum);

    if (deleteError) {
      console.error('❌ 刪除現有分配記錄失敗:', deleteError);
      throw new Error(`刪除現有分配記錄失敗: ${deleteError.message}`);
    }

    console.log(`✅ 成功刪除子賽事 ${contestIdNum} 的所有現有分配記錄`);

    // 🆕 步驟2：重新插入淘汰隊伍記錄
    if (eliminatedTeams.length > 0) {
      // 驗證 parentContestId 是否為有效數字
      const parentContestIdNum = parseInt(parentContestId);
      if (isNaN(parentContestIdNum)) {
        throw new Error(`無效的父賽事ID: ${parentContestId}`);
      }

      const eliminatedInserts = eliminatedTeams.map(team => ({
        main_contest_id: parentContestIdNum, // 父賽事ID
        group_contest_id: contestIdNum, // 子賽事ID
        contest_team_id: team.contest_team_id,
        team_name: team.team_name,
        created_at: new Date().toISOString(),
        created_by: 'system', // 系統自動創建
        status: 'eliminated' // 標記為淘汰
      }));
      
      console.log(`📝 準備插入的淘汰隊伍記錄:`, eliminatedInserts);

      const { error: insertError } = await supabase
        .from('contest_group_assignment')
        .insert(eliminatedInserts);

      if (insertError) {
        console.error('❌ 記錄淘汰隊伍失敗:', insertError);
        throw new Error(`記錄淘汰隊伍失敗: ${insertError.message}`);
      }

      console.log(`✅ 成功記錄 ${eliminatedTeams.length} 支淘汰隊伍到 contest_group_assignment 表`);
    } else {
      console.log(`ℹ️ 沒有淘汰隊伍需要記錄`);
    }

    console.log(`🏆 子賽事完成: ${qualifiedTeams.length} 支隊伍晉級, ${eliminatedTeams.length} 支隊伍淘汰`);
    console.log(`📊 前端待排區現在應該顯示: contest_team 全部隊伍 - contest_group_assignment 中父賽事 ${parentContestId} 的隊伍`);
    
    // 🔧 新增：詳細說明晉級隊伍應該出現在待排清單中
    console.log(`\n🎯 重要說明:`);
    console.log(`  • 晉級隊伍 (${qualifiedTeams.length} 支): ${qualifiedTeams.map(t => `${t.team_name}(ID:${t.contest_team_id})`).join(', ')}`);
    console.log(`  • 這些晉級隊伍已從 contest_group_assignment 表中移除`);
    console.log(`  • 它們現在應該出現在父賽事 ${parentContestId} 的待排清單中`);
    console.log(`  • 如果待排清單沒有顯示這些隊伍，請檢查前端的 fetchPendingTeams 函數`);

  } catch (error) {
    console.error('❌ 處理子賽事晉級失敗:', error);
    throw error;
  }
};

// 循環賽晉級隊伍計算
const getRoundRobinQualifiedTeams = async (contestId: string, advancementCount: number): Promise<QualifiedTeam[]> => {
  try {
    console.log(`🔄 開始計算循環賽晉級隊伍，contestId: ${contestId}, 晉級數量: ${advancementCount}`);
    
    // 獲取所有比賽結果並計算積分
    const { data: matches, error: matchError } = await supabase
      .from('contest_match')
      .select(`
        *,
        contest_match_detail (*)
      `)
      .eq('contest_id', contestId);

    if (matchError) {
      console.error('❌ 獲取比賽記錄失敗:', matchError);
      throw matchError;
    }

    console.log(`📊 獲取到 ${matches?.length || 0} 場比賽記錄`);

    // 🔧 修正：同時嘗試從兩個表獲取隊伍資料
    let teams: any[] = [];
    
    // 先嘗試從 contest_team 表獲取（適用於一般循環賽）
    const { data: directTeams, error: directTeamsError } = await supabase
      .from('contest_team')
      .select('contest_team_id, team_name')
      .eq('contest_id', contestId);

    if (!directTeamsError && directTeams && directTeams.length > 0) {
      teams = directTeams;
      console.log(`👥 從 contest_team 表獲取到 ${teams.length} 支隊伍`);
    } else {
      // 如果 contest_team 表沒有資料，嘗試從 contest_group_assignment 表獲取（適用於混合賽事的子賽事）
      const contestIdNum = parseInt(contestId);
      if (isNaN(contestIdNum)) {
        throw new Error(`無效的 contestId: ${contestId}`);
      }
      
      const { data: assignedTeams, error: assignedTeamsError } = await supabase
        .from('contest_group_assignment')
        .select('contest_team_id, team_name')
        .eq('group_contest_id', contestIdNum);

      if (assignedTeamsError) {
        console.error('❌ 從 contest_group_assignment 表獲取隊伍失敗:', assignedTeamsError);
        throw assignedTeamsError;
      }

      if (assignedTeams && assignedTeams.length > 0) {
        teams = assignedTeams;
        console.log(`👥 從 contest_group_assignment 表獲取到 ${teams.length} 支隊伍`);
      } else {
        throw new Error('找不到參賽隊伍資料');
      }
    }

    if (!teams || teams.length === 0) {
      throw new Error('沒有找到參賽隊伍');
    }

    console.log(`👥 所有參賽隊伍:`, teams);

    // 計算每支隊伍的積分
    const teamStats: Record<number, { wins: number; points: number; teamName: string }> = {};
    
    // 初始化所有隊伍的統計資料
    teams.forEach(team => {
      if (team.contest_team_id && team.team_name) {
        teamStats[team.contest_team_id] = {
          wins: 0,
          points: 0,
          teamName: team.team_name
        };
      } else {
        console.warn('⚠️ 發現無效的隊伍資料:', team);
      }
    });

    console.log(`📊 初始化 ${Object.keys(teamStats).length} 支隊伍的統計資料:`, teamStats);

    // 統計比賽結果
    console.log(`🔄 開始統計比賽結果...`);
    matches?.forEach((match, index) => {
      console.log(`📋 處理比賽 ${index + 1}/${matches.length}:`, {
        match_id: match.match_id,
        team1_id: match.team1_id,
        team2_id: match.team2_id,
        details_count: match.contest_match_detail?.length || 0
      });

      if (match.contest_match_detail && match.contest_match_detail.length > 0) {
        let team1Score = 0;
        let team2Score = 0;

        match.contest_match_detail.forEach((detail: any) => {
          if (detail.winner_team_id === match.team1_id) {
            team1Score++;
          } else if (detail.winner_team_id === match.team2_id) {
            team2Score++;
          }
        });

        console.log(`📊 比賽結果: 隊伍${match.team1_id} ${team1Score}:${team2Score} 隊伍${match.team2_id}`);

        // 確保兩支隊伍都在統計中
        if (!teamStats[match.team1_id]) {
          console.warn(`⚠️ 隊伍 ${match.team1_id} 不在統計中，跳過此比賽`);
          return;
        }
        if (!teamStats[match.team2_id]) {
          console.warn(`⚠️ 隊伍 ${match.team2_id} 不在統計中，跳過此比賽`);
          return;
        }

        // 判定比賽獲勝者並給分
        if (team1Score > team2Score) {
          teamStats[match.team1_id].wins++;
          teamStats[match.team1_id].points += 3; // 勝利得3分
          console.log(`🏆 隊伍${match.team1_id} 獲勝，得3分`);
        } else if (team2Score > team1Score) {
          teamStats[match.team2_id].wins++;
          teamStats[match.team2_id].points += 3; // 勝利得3分
          console.log(`🏆 隊伍${match.team2_id} 獲勝，得3分`);
        } else {
          // 平局各得1分
          teamStats[match.team1_id].points += 1;
          teamStats[match.team2_id].points += 1;
          console.log(`🤝 平局，兩隊各得1分`);
        }
      } else {
        console.log(`⚠️ 比賽 ${match.match_id} 沒有詳細記錄或尚未完成`);
      }
    });

    console.log(`📊 最終統計結果:`, teamStats);

    // 按積分排序並取前N名
    const sortedTeams = Object.entries(teamStats)
      .map(([teamId, stats]) => ({
        contest_team_id: parseInt(teamId),
        team_name: stats.teamName,
        points: stats.points,
        wins: stats.wins
      }))
      .sort((a, b) => {
        // 先按積分排序
        if (b.points !== a.points) {
          return b.points - a.points;
        }
        // 積分相同時按勝場數排序
        if (b.wins !== a.wins) {
          return b.wins - a.wins;
        }
        // 都相同時按隊伍ID排序
        return a.contest_team_id - b.contest_team_id;
      })
      .slice(0, advancementCount);

    console.log(`🏆 排序後的晉級隊伍:`, sortedTeams);
    return sortedTeams;

  } catch (error) {
    console.error('計算循環賽晉級隊伍失敗:', error);
    throw error;
  }
};

// 淘汰賽晉級隊伍計算
const getEliminationQualifiedTeams = async (contestId: string, advancementCount: number): Promise<QualifiedTeam[]> => {
  try {
    console.log(`🏆 ===== 開始淘汰賽排名計算 =====`);
    console.log(`contest_id: ${contestId}, 需要晉級數量: ${advancementCount}`);
    
    // 獲取所有比賽結果
    const { data: matches, error: matchError } = await supabase
      .from('contest_match')
      .select(`
        *,
        contest_match_detail (*)
      `)
      .eq('contest_id', contestId)
      .order('round', { ascending: false });

    if (matchError) throw matchError;
    
    console.log(`📊 獲取到的比賽數據 (${matches?.length || 0} 場):`, matches?.map(m => ({
      match_id: m.match_id,
      round: m.round,
      team1_id: m.team1_id,
      team2_id: m.team2_id,
      winner_team_id: m.winner_team_id,
      match_type: m.match_type,
      ranking_match: m.ranking_match
    })));

    // 🔧 修正：同時從 contest_team 和 contest_group_assignment 表獲取隊伍資料
    // 先嘗試從 contest_team 表獲取（適用於一般淘汰賽）
    let allTeams: any[] = [];
    
    const { data: directTeams, error: directTeamsError } = await supabase
      .from('contest_team')
      .select('contest_team_id, team_name')
      .eq('contest_id', contestId);

    if (!directTeamsError && directTeams && directTeams.length > 0) {
      allTeams = directTeams;
      console.log(`👥 從 contest_team 表獲取到 ${allTeams.length} 支隊伍`);
    } else {
      // 如果 contest_team 表沒有資料，嘗試從 contest_group_assignment 表獲取（適用於混合賽事的子賽事）
      const contestIdNum = parseInt(contestId);
      if (isNaN(contestIdNum)) {
        console.error('❌ 無效的 contestId:', contestId);
        return [];
      }
      
      const { data: assignedTeams, error: assignedTeamsError } = await supabase
        .from('contest_group_assignment')
        .select('contest_team_id, team_name')
        .eq('group_contest_id', contestIdNum);

      if (!assignedTeamsError && assignedTeams) {
        allTeams = assignedTeams;
        console.log(`👥 從 contest_group_assignment 表獲取到 ${allTeams.length} 支隊伍`);
      }
    }
    
    console.log(`👥 所有參賽隊伍:`, allTeams);

    if (!allTeams || allTeams.length === 0) {
      console.warn('⚠️ 沒有找到參賽隊伍，無法計算晉級隊伍');
      return [];
    }

    // 🆕 改進的淘汰賽晉級邏輯：基於淘汰賽的結構而非單純勝場數
    // 在淘汰賽中，排名應該基於：
    // 1. 冠軍：最後一輪的獲勝者
    // 2. 亞軍：最後一輪的失敗者
    // 3. 季軍：倒數第二輪被淘汰的隊伍中排名最高的
    
    const qualifiedTeams: QualifiedTeam[] = [];
    
    if (!matches || matches.length === 0) {
      console.warn('⚠️ 沒有比賽記錄，無法計算晉級隊伍');
      return [];
    }

    // 找到最後一輪（決賽）
    const maxRound = Math.max(...matches.map(m => m.round));
    const finalMatches = matches.filter(m => m.round === maxRound);
    
    console.log(`🏆 決賽輪次: ${maxRound}, 決賽比賽數量: ${finalMatches.length}`);
    console.log('決賽比賽詳情:', finalMatches.map(m => ({
      match_id: m.match_id,
      team1_id: m.team1_id,
      team2_id: m.team2_id,
      winner_team_id: m.winner_team_id,
      match_type: m.match_type,
      ranking_match: m.ranking_match
    })));

    // 找到決賽比賽（通常是最後一輪的第一場比賽）
    const championshipMatch = finalMatches.find(m => 
      m.match_type === 'final' || 
      m.ranking_match === 'champion' || 
      (finalMatches.length === 1 && m.winner_team_id) // 如果只有一場比賽且有獲勝者，視為冠軍戰
    ) || finalMatches[0]; // 如果找不到明確的冠軍戰，使用第一場決賽比賽
    
    const thirdPlaceMatch = finalMatches.find(m => 
      m.match_type === 'third_place' || 
      m.ranking_match === 'third_place'
    );
    
    if (!championshipMatch || !championshipMatch.winner_team_id) {
      console.warn('⚠️ 找不到決賽比賽或決賽尚未完成');
      return [];
    }

    console.log(`🏆 決賽結果:`, {
      match_id: championshipMatch.match_id,
      team1_id: championshipMatch.team1_id,
      team2_id: championshipMatch.team2_id,
      winner_team_id: championshipMatch.winner_team_id
    });

    // 確定冠軍和亞軍
    const championId = championshipMatch.winner_team_id;
    const runnerUpId = championshipMatch.team1_id === championId ? championshipMatch.team2_id : championshipMatch.team1_id;

    // 添加冠軍（第1名）
    const champion = allTeams.find(t => t.contest_team_id === championId);
    if (champion) {
      qualifiedTeams.push({
        contest_team_id: champion.contest_team_id,
        team_name: champion.team_name,
        points: 100 // 冠軍最高分
      });
      console.log(`🥇 第1名 (冠軍): ${champion.team_name} (ID: ${champion.contest_team_id}, 分數: 100)`);
    }

    // 添加亞軍（第2名）
    const runnerUp = allTeams.find(t => t.contest_team_id === runnerUpId);
    if (runnerUp && qualifiedTeams.length < advancementCount) {
      qualifiedTeams.push({
        contest_team_id: runnerUp.contest_team_id,
        team_name: runnerUp.team_name,
        points: 90 // 亞軍次高分
      });
      console.log(`🥈 第2名 (亞軍): ${runnerUp.team_name} (ID: ${runnerUp.contest_team_id}, 分數: 90)`);
    }

    // 添加季軍（第3名）：優先檢查季軍戰，否則找半決賽被淘汰的隊伍
    if (qualifiedTeams.length < advancementCount) {
      console.log(`🥉 尋找季軍...`);
      
      // 🔧 修正：優先檢查是否有季軍戰（third_place match）
      if (thirdPlaceMatch && thirdPlaceMatch.winner_team_id) {
        console.log(`🏆 找到季軍戰:`, {
          match_id: thirdPlaceMatch.match_id,
          team1_id: thirdPlaceMatch.team1_id,
          team2_id: thirdPlaceMatch.team2_id,
          winner_team_id: thirdPlaceMatch.winner_team_id,
          match_type: thirdPlaceMatch.match_type,
          ranking_match: thirdPlaceMatch.ranking_match
        });
        
        const thirdPlaceWinnerId = thirdPlaceMatch.winner_team_id;
        const thirdPlace = allTeams.find(t => t.contest_team_id === thirdPlaceWinnerId);
        if (thirdPlace) {
          qualifiedTeams.push({
            contest_team_id: thirdPlace.contest_team_id,
            team_name: thirdPlace.team_name,
            points: 80 // 季軍第三高分
          });
          console.log(`🥉 第3名 (季軍戰獲勝者): ${thirdPlace.team_name} (ID: ${thirdPlace.contest_team_id}, 分數: 80)`);
        }
      } else {
        // 如果沒有季軍戰，則找半決賽中被淘汰的隊伍
        const semiRound = maxRound - 1;
        const semiMatches = matches.filter(m => m.round === semiRound);
        
        console.log(`🔍 沒有季軍戰，查找半決賽被淘汰隊伍，半決賽輪次: ${semiRound}, 半決賽比賽數量: ${semiMatches.length}`);
        
        if (semiMatches.length > 0) {
          // 找到所有半決賽中被淘汰的隊伍
          const eliminatedInSemi: number[] = [];
          
          for (const semiMatch of semiMatches) {
            if (semiMatch.winner_team_id) {
              const loserId = semiMatch.team1_id === semiMatch.winner_team_id 
                ? semiMatch.team2_id 
                : semiMatch.team1_id;
              eliminatedInSemi.push(loserId);
            }
          }
          
          console.log('半決賽被淘汰的隊伍ID:', eliminatedInSemi);
          
          // 🔧 修正：如果有多個半決賽失敗者，選擇較好的排名
          if (eliminatedInSemi.length > 0) {
            // 如果有多個失敗者，按勝場數排序選擇最佳的
            if (eliminatedInSemi.length > 1) {
              const semiFinalistStats = eliminatedInSemi.map(teamId => {
                const wins = matches.filter(m => m.winner_team_id === teamId).length;
                return { teamId, wins };
              }).sort((a, b) => b.wins - a.wins);
              
              console.log('半決賽失敗者統計:', semiFinalistStats);
              
              const bestSemiFinalist = semiFinalistStats[0];
              const thirdPlace = allTeams.find(t => t.contest_team_id === bestSemiFinalist.teamId);
              if (thirdPlace) {
                qualifiedTeams.push({
                  contest_team_id: thirdPlace.contest_team_id,
                  team_name: thirdPlace.team_name,
                  points: 80 // 季軍第三高分
                });
                console.log(`🥉 第3名 (最佳半決賽失敗者): ${thirdPlace.team_name} (ID: ${thirdPlace.contest_team_id}, ${bestSemiFinalist.wins}勝, 分數: 80)`);
              }
            } else {
              // 只有一個半決賽失敗者
              const thirdPlaceId = eliminatedInSemi[0];
              const thirdPlace = allTeams.find(t => t.contest_team_id === thirdPlaceId);
              if (thirdPlace) {
                qualifiedTeams.push({
                  contest_team_id: thirdPlace.contest_team_id,
                  team_name: thirdPlace.team_name,
                  points: 80 // 季軍第三高分
                });
                console.log(`🥉 第3名 (半決賽失敗者): ${thirdPlace.team_name} (ID: ${thirdPlace.contest_team_id}, 分數: 80)`);
              }
            }
          }
        } else {
          // 如果找不到半決賽，則找所有未進入決賽的隊伍中的第一個
          const allTeamIds = new Set(allTeams.map(t => t.contest_team_id));
          const nonFinalistIds = Array.from(allTeamIds).filter(id => id !== championId && id !== runnerUpId);
          if (nonFinalistIds.length > 0) {
            const thirdPlaceId = nonFinalistIds[0];
            const thirdPlace = allTeams.find(t => t.contest_team_id === thirdPlaceId);
            if (thirdPlace) {
              qualifiedTeams.push({
                contest_team_id: thirdPlace.contest_team_id,
                team_name: thirdPlace.team_name,
                points: 80 // 季軍第三高分
              });
              console.log(`🥉 第3名 (其他隊伍): ${thirdPlace.team_name} (ID: ${thirdPlace.contest_team_id}, 分數: 80)`);
            }
          }
        }
      }
    }

    // 🔧 如果還需要更多晉級隊伍，使用準決賽失敗者或按勝場數排序
    if (qualifiedTeams.length < advancementCount) {
      console.log(`📊 需要更多晉級隊伍，當前已有 ${qualifiedTeams.length}，需要 ${advancementCount}`);
      
      // 統計每支隊伍的勝場數（排除已經晉級的隊伍）
      const qualifiedTeamIds = new Set(qualifiedTeams.map(t => t.contest_team_id));
      const teamWins: Record<number, { wins: number; teamName: string }> = {};
      
      allTeams.forEach(team => {
        if (!qualifiedTeamIds.has(team.contest_team_id)) {
          teamWins[team.contest_team_id] = {
            wins: 0,
            teamName: team.team_name
          };
        }
      });

      // 統計勝場數
      matches.forEach(match => {
        if (match.winner_team_id && teamWins[match.winner_team_id]) {
          teamWins[match.winner_team_id].wins++;
        }
      });

      // 按勝場數排序剩餘隊伍
      const remainingTeams = Object.entries(teamWins)
        .map(([teamId, stats]) => ({
          contest_team_id: parseInt(teamId),
          team_name: stats.teamName,
          wins: stats.wins
        }))
        .sort((a, b) => {
          // 先按勝場數排序
          if (b.wins !== a.wins) {
            return b.wins - a.wins;
          }
          
          // 🆕 勝場數相同時，檢查直接對戰結果
          const headToHeadResult = getHeadToHeadResult(a.contest_team_id, b.contest_team_id, matches);
          if (headToHeadResult !== null) {
            console.log(`🏆 直接對戰結果: 隊伍${headToHeadResult < 0 ? a.contest_team_id : b.contest_team_id} 勝過 隊伍${headToHeadResult < 0 ? b.contest_team_id : a.contest_team_id}`);
            return headToHeadResult; // 勝者排前面
          }
          
          // 沒有直接對戰記錄時，按隊伍ID排序
          return a.contest_team_id - b.contest_team_id;
        });

      // 添加剩餘的晉級隊伍
      const remainingSlots = advancementCount - qualifiedTeams.length;
      for (let i = 0; i < Math.min(remainingSlots, remainingTeams.length); i++) {
        const team = remainingTeams[i];
        // 🔧 修正：按照正確的排名分配分數
        let points = 80; // 季軍預設分數
        if (qualifiedTeams.length === 2) points = 80; // 第3名
        else if (qualifiedTeams.length === 3) points = 70; // 第4名
        else points = 60 - (i); // 其他名次
        
        qualifiedTeams.push({
          contest_team_id: team.contest_team_id,
          team_name: team.team_name,
          points: points
        });
        console.log(`🏅 第${qualifiedTeams.length}名: ${team.team_name} (${team.wins}勝, ${points}分)`);
      }
    }

    console.log(`\n🏅 ===== 淘汰賽排名計算完成 =====`);
    console.log(`最終晉級隊伍數量: ${qualifiedTeams.length}/${advancementCount}`);
    console.log('淘汰賽最終排名結果:');
    qualifiedTeams.forEach((team, index) => {
      console.log(`  🏆 第${index + 1}名: ${team.team_name} (ID: ${team.contest_team_id}, 分數: ${team.points})`);
    });
    
    // 🔧 重要：確保 qualified_teams 的順序是按照排名順序（第1名在前）
    // 檢查是否需要重新排序
    const isSortedCorrectly = qualifiedTeams.every((team, index) => {
      if (index === 0) return true; // 第一個總是正確的
      return qualifiedTeams[index - 1].points >= team.points;
    });
    
    if (!isSortedCorrectly) {
      console.log('⚠️ 檢測到排名順序不正確，重新排序...');
      qualifiedTeams.sort((a, b) => {
        // 按分數降序排列（高分在前）
        if (b.points !== a.points) {
          return b.points - a.points;
        }
        // 分數相同時按隊伍ID排序
        return a.contest_team_id - b.contest_team_id;
      });
      
      console.log('重新排序後的結果:');
      qualifiedTeams.forEach((team, index) => {
        console.log(`  🏆 第${index + 1}名: ${team.team_name} (ID: ${team.contest_team_id}, 分數: ${team.points})`);
      });
    } else {
      console.log('✅ 排名順序正確');
    }
    
    console.log('=====================================\n');
    
    return qualifiedTeams;

  } catch (error) {
    console.error('計算淘汰賽晉級隊伍失敗:', error);
    throw error;
  }
};

// 🆕 檢查兩隊直接對戰結果的輔助函數
const getHeadToHeadResult = (teamA_id: number, teamB_id: number, matches: any[]): number | null => {
  console.log(`🔍 檢查直接對戰: 隊伍${teamA_id} vs 隊伍${teamB_id}`);
  
  // 尋找兩隊的直接對戰記錄
  const directMatch = matches.find(match => {
    const isDirectMatch = (match.team1_id === teamA_id && match.team2_id === teamB_id) ||
                         (match.team1_id === teamB_id && match.team2_id === teamA_id);
    
    if (isDirectMatch) {
      console.log(`📋 找到直接對戰記錄:`, {
        match_id: match.match_id,
        team1_id: match.team1_id,
        team2_id: match.team2_id,
        winner_team_id: match.winner_team_id,
        round: match.round
      });
    }
    
    return isDirectMatch;
  });
  
  if (!directMatch) {
    console.log(`❌ 沒有找到隊伍${teamA_id} vs 隊伍${teamB_id} 的直接對戰記錄`);
    return null;
  }
  
  if (!directMatch.winner_team_id) {
    console.log(`⏳ 直接對戰比賽尚未完成 (沒有獲勝者)`);
    return null;
  }
  
  // 返回排名順序：勝者排前面（負數），敗者排後面（正數）
  if (directMatch.winner_team_id === teamA_id) {
    console.log(`🏆 隊伍${teamA_id} 在直接對戰中勝過隊伍${teamB_id}`);
    return -1; // teamA 勝，排在 teamB 前面
  } else if (directMatch.winner_team_id === teamB_id) {
    console.log(`🏆 隊伍${teamB_id} 在直接對戰中勝過隊伍${teamA_id}`);
    return 1;  // teamB 勝，排在 teamA 前面
  }
  
  console.log(`❓ 直接對戰結果異常: winner_team_id=${directMatch.winner_team_id} 不匹配任一隊伍`);
  return null; // 異常情況
};