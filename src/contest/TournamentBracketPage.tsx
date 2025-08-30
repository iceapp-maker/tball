import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";
import { finishContest as finishContestUtil } from './utils/contestFinishAndAdvancement';
import './TournamentBracketPage.css';

// 類型定義
interface TeamData {
  contest_team_id: number;
  team_name: string;
  captain_name?: string;
  status: 'unassigned' | 'advanced' | 'eliminated' | 'current_round';
  source_info?: string; // 例如：'第1輪晉級'、'第2輪淘汰'
}

interface MatchData {
  match_id?: number;
  team1_id: number | null;
  team2_id: number | null;
  winner_team_id: number | null;
  round: number;
  match_order: number;
  status: 'pending' | 'ongoing' | 'completed';
  round_name?: string;
  score_summary?: string; // 例如：'3:1'
  match_type?: 'regular' | 'final' | 'semi_final' | 'third_place' | 'ranking';
  match_description?: string; // 例如：'冠亞軍決賽'、'季軍戰'
  is_final_match?: boolean;
  ranking_match?: 'champion' | 'third_place' | 'fifth_place' | null;
}

interface RoundData {
  round_number: number;
  round_name: string;
  matches: MatchData[];
  is_current: boolean;
}

const TournamentBracketPage: React.FC = () => {
  const { contestId } = useParams<{ contestId: string }>();
  const navigate = useNavigate();
  
  // 基本狀態
  const [contestData, setContestData] = useState<any>(null);
  const [allTeams, setAllTeams] = useState<TeamData[]>([]);
  const [rounds, setRounds] = useState<RoundData[]>([]);
  const [currentRound, setCurrentRound] = useState<number>(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isAddingMatch, setIsAddingMatch] = useState(false);

  // 獲取登錄用戶信息
  const user = JSON.parse(localStorage.getItem('loginUser') || '{}');

  // 為新比賽創建 contest_match_detail 記錄
  const createMatchDetailsForNewMatches = async (matches: any[]) => {
    try {
      for (const match of matches) {
        // 獲取比賽設定
        const totalPoints = contestData?.total_points || 3;
        let pointsConfig: any[] = [];
        
        try {
          if (contestData?.points_config) {
            if (typeof contestData.points_config === 'string') {
              pointsConfig = JSON.parse(contestData.points_config);
            } else {
              pointsConfig = contestData.points_config;
            }
            
            // 統一格式化比賽類型
            pointsConfig = pointsConfig.map(item => {
              if (!item.type || item.type === 'singles') {
                return { ...item, type: '單打' };
              } else if (item.type === 'doubles') {
                return { ...item, type: '雙打' };
              }
              return item;
            });
          }
        } catch (e) {
          // 預設配置：2場雙打 + 1場單打
          pointsConfig = [
            { type: '雙打', points: 1 },
            { type: '雙打', points: 1 },
            { type: '單打', points: 1 }
          ];
        }
        
        // 為每場比賽建立詳細記錄
        const matchDetails = [];
        for (let i = 0; i < totalPoints; i++) {
          let matchType = '單打';
          
          if (pointsConfig && pointsConfig.length > 0) {
            const configIndex = i < pointsConfig.length ? i : pointsConfig.length - 1;
            let configType = pointsConfig[configIndex].type || '單打';
            
            // 統一格式化
            if (configType.toLowerCase() === 'singles') {
              configType = '單打';
            } else if (configType.toLowerCase() === 'doubles') {
              configType = '雙打';
            }
            
            matchType = (configType === '單打' || configType === '雙打') ? configType : '單打';
          } else {
            // 預設：前2場雙打，後面單打
            matchType = i < 2 ? '雙打' : '單打';
          }
          
          matchDetails.push({
            match_id: match.match_id,
            contest_id: String(contestId),
            match_type: matchType,
            sequence: i + 1,
            team1_member_ids: [],
            team2_member_ids: [],
            winner_team_id: null,
            score: null,
            bracket_round: match.round
          });
        }
        
        // 批次插入 match_detail 記錄
        const { error: detailError } = await supabase
          .from('contest_match_detail')
          .insert(matchDetails);
        
        if (detailError) {
          console.error('創建比賽詳細記錄失敗:', detailError);
        } else {
          console.log(`成功為比賽 ${match.match_id} 創建 ${matchDetails.length} 筆詳細記錄`);
        }
      }
    } catch (error) {
      console.error('創建比賽詳細記錄時發生錯誤:', error);
    }
  };

  // 獲取比賽基本資料
  const fetchContestData = async () => {
    try {
      console.log('🎯 開始載入比賽資料...');
      const contestIdStr = String(contestId);
      
      const { data: contest, error: contestError } = await supabase
        .from('contest')
        .select('*')
        .eq('contest_id', contestIdStr)
        .single();

      if (contestError) throw contestError;
      setContestData(contest);
      console.log('✅ 比賽基本資料載入完成');

      // 先獲取所有隊伍資料
      console.log('🔄 開始載入隊伍資料...');
      const teamsData = await fetchAllTeamsData();
      console.log('✅ 隊伍資料載入完成，隊伍數量:', teamsData.length);
      
      // 確保隊伍資料已設置到狀態中
      if (teamsData.length === 0) {
        console.warn('⚠️ 警告：沒有載入到任何隊伍資料');
        // 🔧 即使沒有隊伍資料，也要確保有基本的對戰安排界面
        setError('沒有找到隊伍資料，請檢查子賽事是否已正確分配隊伍');
      } else {
        console.log(`✅ 成功載入 ${teamsData.length} 支隊伍，可以開始安排對戰`);
      }
      
      // 再獲取現有比賽記錄（需要隊伍資料來顯示比分）
      console.log('🔄 開始載入比賽記錄...');
      await fetchExistingMatches(teamsData);
      console.log('✅ 比賽記錄載入完成');
      
      // 🔍 載入完成後進行數據一致性檢查
      setTimeout(async () => {
        console.log('🔍 開始數據一致性檢查和主動修復...');
        console.log('📊 此時 allTeams 數量:', allTeams.length);
        console.log('📋 此時 allTeams 列表:', allTeams.map(t => `${t.contest_team_id}:${t.team_name}`));
        
        await validateDataConsistency();
        
        // 🔧 額外檢查：主動修復所有顯示為 "隊伍XXX" 的名稱
        await proactiveTeamNameFix();
        
        console.log('✅ 數據一致性檢查和主動修復完成');
      }, 100); // 稍微延遲以確保狀態更新完成
      
    } catch (error) {
      console.error('❌ 獲取比賽資料失敗:', error);
      setError('獲取比賽資料失敗');
    }
  };

  // 獲取所有隊伍資料（返回數據，不設置狀態）
  const fetchAllTeamsData = async (): Promise<TeamData[]> => {
    try {
      console.log('🚀 開始獲取隊伍資料，contestId:', contestId, 'type:', typeof contestId);
      
      // 確保 contestId 是字符串格式
      const contestIdStr = String(contestId);
      
      // 首先檢查當前賽事的類型和父賽事關係
      const { data: contestInfo, error: contestInfoError } = await supabase
        .from('contest')
        .select('parent_contest_id, contest_type')
        .eq('contest_id', contestIdStr)
        .single();

      if (contestInfoError) {
        console.error('獲取賽事信息失敗:', contestInfoError);
        throw contestInfoError;
      }

      let teams: any[] = [];
      
      // 如果有 parent_contest_id，表示這是混合賽事的子賽事
      if (contestInfo.parent_contest_id) {
        console.log('檢測到混合賽事的子賽事，從 contest_group_assignment 表查詢隊伍');
        
        // 從 contest_group_assignment 表獲取分配給此子賽事的隊伍
        const { data: assignedTeams, error: assignedError } = await supabase
          .from('contest_group_assignment')
          .select('contest_team_id, team_name')
          .eq('group_contest_id', parseInt(contestIdStr));

        if (assignedError) {
          console.error('混合賽事隊伍查詢錯誤:', assignedError);
          throw assignedError;
        }

        teams = assignedTeams || [];
        console.log('混合賽事隊伍查詢結果:', { teams, contestId: contestIdStr });
      } else {
        console.log('檢測到單淘汰賽或單循環賽，從 contest_team 表查詢隊伍');
        
        // 從 contest_team 表獲取隊伍（單淘汰賽/單循環賽）
        const { data: directTeams, error: directError } = await supabase
          .from('contest_team')
          .select('contest_team_id, team_name')
          .eq('contest_id', contestIdStr);

        if (directError) {
          console.error('單淘汰賽隊伍查詢錯誤:', directError);
          throw directError;
        }

        teams = directTeams || [];
        console.log('單淘汰賽隊伍查詢結果:', { teams, contestId: contestIdStr });
      }

      if (!teams || teams.length === 0) {
        console.warn('沒有找到隊伍資料，請檢查賽事配置');
        setAllTeams([]);
        return [];
      }

      // 獲取所有隊伍的隊長信息
      const teamIds = teams.map(team => team.contest_team_id);
      const { data: captains, error: captainsError } = await supabase
        .from('contest_team_member')
        .select('contest_team_id, member_name')
        .in('contest_team_id', teamIds)
        .eq('status', 'captain');

      console.log('隊長查詢結果:', { captains, captainsError });

      if (captainsError) {
        console.warn('獲取隊長資料失敗:', captainsError);
      }

      // 獲取已安排的比賽來判斷隊伍狀態
      const { data: matches, error: matchesError } = await supabase
        .from('contest_match')
        .select('team1_id, team2_id, winner_team_id, round')
        .eq('contest_id', contestIdStr);

      console.log('比賽查詢結果:', { matches, matchesError, contestId: contestIdStr });

      if (matchesError) {
        console.error('比賽查詢錯誤:', matchesError);
        throw matchesError;
      }

      // 分析隊伍狀態並合併隊長信息
      const teamsWithStatus = teams.map(team => {
        // 找到該隊伍的隊長
        const captain = captains?.find(c => c.contest_team_id === team.contest_team_id);
        const teamMatches = matches.filter(m => 
          m.team1_id === team.contest_team_id || m.team2_id === team.contest_team_id
        );

        let status: TeamData['status'] = 'unassigned';
        let source_info = '未安排';

        if (teamMatches.length > 0) {
          // 找到最新的比賽
          const latestMatch = teamMatches.reduce((latest, current) => 
            current.round > latest.round ? current : latest
          );

          if (latestMatch.winner_team_id === team.contest_team_id) {
            status = 'advanced';
            source_info = `第${latestMatch.round}輪晉級`;
          } else if (latestMatch.winner_team_id && latestMatch.winner_team_id !== team.contest_team_id) {
            status = 'eliminated';
            source_info = `第${latestMatch.round}輪淘汰`;
          } else {
            status = 'current_round';
            source_info = `第${latestMatch.round}輪已安排`;
          }
        }

        return {
          ...team,
          captain_name: captain?.member_name || '未指定',
          status,
          source_info
        };
      });

      console.log('✅ 處理後的隊伍資料:', teamsWithStatus);
      console.log('📊 隊伍資料統計:');
      console.log(`   - 總隊伍數: ${teamsWithStatus.length}`);
      console.log(`   - 隊伍ID列表: [${teamsWithStatus.map(t => t.contest_team_id).join(', ')}]`);
      console.log(`   - 隊伍名稱列表: [${teamsWithStatus.map(t => t.team_name).join(', ')}]`);
      
      setAllTeams(teamsWithStatus);
      return teamsWithStatus;
    } catch (error) {
      console.error('獲取隊伍資料失敗:', error);
      setError(`獲取隊伍資料失敗: ${error.message || error}`);
      return [];
    }
  };

  // 獲取所有隊伍並分類狀態（保持原有接口）
  const fetchAllTeams = async () => {
    await fetchAllTeamsData();
  };

  // 🔍 數據一致性檢查函數
  const validateDataConsistency = async () => {
    console.log('🔍 開始數據一致性檢查...');
    
    // 收集所有比賽中使用的隊伍ID
    const usedTeamIds = new Set<number>();
    rounds.forEach(round => {
      round.matches.forEach(match => {
        if (match.team1_id) usedTeamIds.add(match.team1_id);
        if (match.team2_id) usedTeamIds.add(match.team2_id);
        if (match.winner_team_id) usedTeamIds.add(match.winner_team_id);
      });
    });
    
    // 檢查哪些隊伍ID在allTeams中找不到
    const availableTeamIds = new Set(allTeams.map(t => t.contest_team_id));
    const missingTeamIds = Array.from(usedTeamIds).filter(id => !availableTeamIds.has(id));
    
    if (missingTeamIds.length > 0) {
      console.error('❌ 數據不一致：以下隊伍ID在比賽中使用但在allTeams中找不到:');
      console.error('   缺失的隊伍IDs:', missingTeamIds);
      console.log('   可用的隊伍IDs:', Array.from(availableTeamIds));
      console.log('   使用中的隊伍IDs:', Array.from(usedTeamIds));
      
      // 🔧 批量查詢缺失的隊伍名稱
      await batchFetchMissingTeamNames(missingTeamIds);
    } else {
      console.log('✅ 數據一致性檢查通過');
    }
    
    return missingTeamIds;
  };

  // 批量查詢缺失的隊伍名稱
  const batchFetchMissingTeamNames = async (missingTeamIds: number[]) => {
    try {
      console.log(`🔄 批量查詢 ${missingTeamIds.length} 個缺失的隊伍名稱...`);
      
      // 🔧 修復：同時從 contest_team 和 contest_group_assignment 表查詢
      // 先從 contest_team 表查詢
      const { data: directTeams, error: directError } = await supabase
        .from('contest_team')
        .select('contest_team_id, team_name')
        .in('contest_team_id', missingTeamIds);

      if (directError) {
        console.error('❌ 從 contest_team 表查詢隊伍名稱失敗:', directError);
      }

      // 再從 contest_group_assignment 表查詢（針對混合賽事的子賽事）
      const { data: assignedTeams, error: assignedError } = await supabase
        .from('contest_group_assignment')
        .select('contest_team_id, team_name')
        .in('contest_team_id', missingTeamIds);

      if (assignedError) {
        console.error('❌ 從 contest_group_assignment 表查詢隊伍名稱失敗:', assignedError);
      }

      // 合併兩個查詢結果，去重
      const allFoundTeams = new Map<number, string>();
      
      if (directTeams) {
        directTeams.forEach(team => {
          allFoundTeams.set(team.contest_team_id, team.team_name);
        });
      }
      
      if (assignedTeams) {
        assignedTeams.forEach(team => {
          allFoundTeams.set(team.contest_team_id, team.team_name);
        });
      }

      if (allFoundTeams.size > 0) {
        console.log(`✅ 成功查詢到 ${allFoundTeams.size} 個隊伍名稱:`, Array.from(allFoundTeams.entries()));
        
        // 將查詢結果加入緩存
        allFoundTeams.forEach((teamName, teamId) => {
          teamNameCache.set(teamId, teamName);
          console.log(`📝 緩存隊伍名稱: ${teamName} (ID: ${teamId})`);
        });
        
        // 🔧 保存緩存到 sessionStorage
        saveTeamNameCache();
        
        // 觸發重新渲染以更新顯示
        setAllTeams(prev => [...prev]);
        
        console.log('🔄 觸發頁面重新渲染以更新隊伍名稱顯示');
      } else {
        console.warn('⚠️ 沒有查詢到任何隊伍資料');
      }
    } catch (error) {
      console.error('❌ 批量查詢隊伍名稱時發生錯誤:', error);
    }
  };

  // 🔧 新增：更新比分摘要函數
  const updateScoreSummaries = (matches: any[]) => {
    console.log('🔄 開始更新比分摘要...');
    console.log('📊 當前 allTeams 數量:', allTeams.length);
    console.log('📋 allTeams 列表:', allTeams.map(t => `${t.contest_team_id}:${t.team_name}`));
    console.log('💾 當前緩存數量:', teamNameCache.size);
    console.log('💾 緩存內容:', Array.from(teamNameCache.entries()));
    console.log('🎯 要處理的比賽數量:', matches.length);
    
    setRounds(prevRounds => {
      const updatedRounds = prevRounds.map(round => ({
        ...round,
        matches: round.matches.map(match => {
          console.log(`🎯 處理比賽: 輪次${match.round}, team1_id=${match.team1_id}, team2_id=${match.team2_id}`);
          
          // 找到對應的原始比賽數據
          const originalMatch = matches.find(m => 
            m.team1_id === match.team1_id && 
            m.team2_id === match.team2_id && 
            m.round === match.round
          );
          
          if (!originalMatch) {
            console.log(`❌ 找不到對應的原始比賽數據`);
            return match;
          }
          
          if (!originalMatch.winner_team_id) {
            console.log(`⏳ 比賽尚未完成，winner_team_id 為空`);
            return match; // 沒有比分結果，保持原狀
          }
          
          console.log(`🏆 比賽已完成，winner_team_id: ${originalMatch.winner_team_id}`);
          
          // 計算實際比分
          const team1Wins = originalMatch.contest_match_detail?.filter((detail: any) => 
            detail.winner_team_id === originalMatch.team1_id
          ).length || 0;
          
          const team2Wins = originalMatch.contest_match_detail?.filter((detail: any) => 
            detail.winner_team_id === originalMatch.team2_id
          ).length || 0;
          
          console.log(`📊 比分統計: team1_wins=${team1Wins}, team2_wins=${team2Wins}`);
          
          // 🔧 使用 getTeamDisplayName 函數來獲取隊伍名稱
          console.log(`🔍 開始獲取隊伍名稱...`);
          const team1Name = getTeamDisplayName(originalMatch.team1_id);
          const team2Name = getTeamDisplayName(originalMatch.team2_id);
          const winnerName = getTeamDisplayName(originalMatch.winner_team_id);
          
          console.log(`📝 獲取到的隊伍名稱: team1="${team1Name}", team2="${team2Name}", winner="${winnerName}"`);
          
          const newScoreSummary = `${team1Name} ${team1Wins}:${team2Wins} ${team2Name} (${winnerName}勝)`;
          console.log(`🆕 新的比分摘要: "${newScoreSummary}"`);
          console.log(`🔄 原始比分摘要: "${match.score_summary}"`);
          
          // 只有當比分摘要真的改變時才更新
          if (match.score_summary !== newScoreSummary) {
            console.log(`✅ 比分摘要已更新: ${match.score_summary} -> ${newScoreSummary}`);
            return {
              ...match,
              score_summary: newScoreSummary
            };
          } else {
            console.log(`⏸️ 比分摘要無變化，保持原狀`);
          }
          
          return match;
        })
      }));
      
      return updatedRounds;
    });
    
    console.log('✅ 比分摘要更新完成');
  };

  // 獲取現有比賽記錄並組織成輪次
  const fetchExistingMatches = async (teamsData?: TeamData[]) => {
    const teams = teamsData || allTeams;
    try {
      const { data: matches, error: matchesError } = await supabase
        .from('contest_match')
        .select(`
          match_id,
          team1_id,
          team2_id,
          winner_team_id,
          round,
          match_order,
          status,
          round_name,
          contest_match_detail (
            winner_team_id,
            match_type,
            sequence
          )
        `)
        .eq('contest_id', String(contestId))
        .order('round', { ascending: true })
        .order('match_order', { ascending: true });

      if (matchesError) throw matchesError;

      // 🔧 在處理比賽記錄前，先收集所有需要的隊伍ID並批量查詢
      const allTeamIdsInMatches = new Set<number>();
      matches.forEach(match => {
        if (match.team1_id) allTeamIdsInMatches.add(match.team1_id);
        if (match.team2_id) allTeamIdsInMatches.add(match.team2_id);
        if (match.winner_team_id) allTeamIdsInMatches.add(match.winner_team_id);
      });

      console.log(`🔍 比賽中使用的所有隊伍IDs: [${Array.from(allTeamIdsInMatches).join(', ')}]`);

      // 找出在 teams 中不存在的隊伍ID
      const availableTeamIds = new Set(teams.map(t => t.contest_team_id));
      console.log(`📋 當前可用的隊伍IDs: [${Array.from(availableTeamIds).join(', ')}]`);
      
      const missingTeamIds = Array.from(allTeamIdsInMatches).filter(id => !availableTeamIds.has(id));
      console.log(`❌ 缺失的隊伍IDs: [${missingTeamIds.join(', ')}]`);

      // 如果有缺失的隊伍，先批量查詢
      if (missingTeamIds.length > 0) {
        console.log(`🔄 在處理比賽記錄前，先查詢 ${missingTeamIds.length} 個缺失的隊伍名稱...`);
        await batchFetchMissingTeamNames(missingTeamIds);
      }

      // 組織成輪次結構
      const roundsMap = new Map<number, MatchData[]>();
      let maxRound = 0;

      // 🔧 修復：延遲生成比分摘要，確保隊伍名稱已載入
      const matchesWithoutSummary = matches.map(match => {
        if (!roundsMap.has(match.round)) {
          roundsMap.set(match.round, []);
        }
        
        // 先不生成比分摘要，只處理基本狀態
        let score_summary = '';
        if (match.winner_team_id && match.team1_id && match.team2_id) {
          score_summary = '已完成'; // 臨時狀態，稍後更新
        } else if (match.team1_id && match.team2_id) {
          score_summary = '進行中';
        } else {
          score_summary = '未開始';
        }

        const processedMatch = {
          ...match,
          status: match.status || (match.winner_team_id ? 'completed' : (match.team1_id && match.team2_id ? 'ongoing' : 'pending')),
          score_summary
        };

        roundsMap.get(match.round)!.push(processedMatch);
        maxRound = Math.max(maxRound, match.round);
        
        return processedMatch;
      });

      // 轉換為 RoundData 陣列
      const roundsArray: RoundData[] = [];
      for (let i = 1; i <= Math.max(maxRound, 1); i++) {
        roundsArray.push({
          round_number: i,
          round_name: `第${i}輪`,
          matches: roundsMap.get(i) || [],
          is_current: i === currentRound
        });
      }

      setRounds(roundsArray);
      
      // 🔧 設定當前輪次為最後一輪
      if (roundsArray.length > 0) {
        const lastRound = Math.max(...roundsArray.map(r => r.round_number));
        setCurrentRound(lastRound);
        console.log(`設定當前輪次為最後一輪: ${lastRound}`);
      }
      
      // 🔧 延遲更新比分摘要，確保隊伍名稱已載入
      setTimeout(() => {
        console.log('⏰ 延遲更新比分摘要開始執行...');
        console.log('📊 延遲更新時 allTeams 數量:', allTeams.length);
        console.log('💾 延遲更新時緩存數量:', teamNameCache.size);
        updateScoreSummaries(matches);
      }, 100);
      
      // 🔧 修正：對於子賽事，即使沒有比賽記錄也要創建初始對戰安排界面
      if (matches.length === 0) {
        console.log('🎯 沒有比賽記錄，創建第一輪的空白對戰...');
        await createEmptyRound(1);
        
        // 🆕 對於子賽事，如果有隊伍但沒有對戰記錄，自動創建一場空白對戰供管理者安排
        if (teams.length > 0) {
          console.log(`🎯 子賽事有 ${teams.length} 支隊伍，自動創建對戰安排界面`);
        }
      }

    } catch (error) {
      console.error('獲取比賽記錄失敗:', error);
      setError('獲取比賽記錄失敗');
    }
  };

  // 創建空白輪次
  const createEmptyRound = async (roundNumber: number) => {
    console.log(`🎯 創建第${roundNumber}輪的空白對戰...`);
    
    // 創建包含一場空白對戰的新輪次
    const newMatch: MatchData = {
      team1_id: null,
      team2_id: null,
      winner_team_id: null,
      round: roundNumber,
      match_order: 1,
      status: 'pending',
      score_summary: '未開始'
    };

    const newRound: RoundData = {
      round_number: roundNumber,
      round_name: `第${roundNumber}輪`,
      matches: [newMatch], // 🔧 直接在創建輪次時包含一場對戰
      is_current: true
    };

    setRounds(prev => {
      const updated = [...prev];
      const existingIndex = updated.findIndex(r => r.round_number === roundNumber);
      if (existingIndex >= 0) {
        console.log(`🔄 更新現有第${roundNumber}輪`);
        updated[existingIndex] = newRound;
      } else {
        console.log(`🆕 新增第${roundNumber}輪`);
        updated.push(newRound);
        updated.sort((a, b) => a.round_number - b.round_number);
      }
      return updated;
    });

    setCurrentRound(roundNumber);
    console.log(`✅ 第${roundNumber}輪創建完成，包含 1 場空白對戰`);
  };

  // 新增對戰到當前輪次
  const addMatchToCurrentRound = () => {
    // 🔒 防止重複執行
    if (saving || isAddingMatch) {
      console.log('操作進行中，忽略重複的新增對戰請求');
      return;
    }

    setIsAddingMatch(true);
    console.log('新增對戰到當前輪次');
    
    // 使用 callback 形式確保狀態更新的原子性
    setRounds(prev => {
      const updated = [...prev];
      const currentRoundIndex = updated.findIndex(r => r.round_number === currentRound);
      
      if (currentRoundIndex >= 0) {
        const currentMatches = updated[currentRoundIndex].matches;
        const newMatchOrder = currentMatches.length + 1;
        
        const newMatch: MatchData = {
          team1_id: null,
          team2_id: null,
          winner_team_id: null,
          round: currentRound,
          match_order: newMatchOrder,
          status: 'pending',
          score_summary: '未開始'
        };
        
        console.log(`新增對戰: 輪次${currentRound}, 順序${newMatchOrder}, 當前對戰數${currentMatches.length}`);
        updated[currentRoundIndex].matches.push(newMatch);
      }
      
      return updated;
    });

    // 延遲重置狀態，確保 React 渲染完成
    setTimeout(() => {
      setIsAddingMatch(false);
    }, 100); // 恢復正常延遲時間
  };

  // 更新對戰隊伍
  const updateMatchTeam = (roundNumber: number, matchIndex: number, teamSlot: 'team1' | 'team2', teamId: number | null) => {
    setRounds(prev => {
      const updated = [...prev];
      const roundIndex = updated.findIndex(r => r.round_number === roundNumber);
      
      if (roundIndex >= 0 && matchIndex < updated[roundIndex].matches.length) {
        const match = updated[roundIndex].matches[matchIndex];
        
        if (teamSlot === 'team1') {
          match.team1_id = teamId;
        } else {
          match.team2_id = teamId;
        }

        // 更新狀態和摘要
        if (match.team1_id && match.team2_id) {
          match.status = 'ongoing';
          match.score_summary = '進行中';
        } else {
          match.status = 'pending';
          match.score_summary = '未開始';
        }
      }
      
      return updated;
    });

    // 重新計算隊伍狀態
    fetchAllTeams();
  };

  // 刪除對戰
  const deleteMatch = async (roundNumber: number, matchIndex: number) => {
    // 🔒 防止重複執行
    if (saving || isDeleting) {
      console.log('操作進行中，忽略重複的刪除請求');
      return;
    }

    try {
      const currentRoundData = rounds.find(r => r.round_number === roundNumber);
      if (!currentRoundData || matchIndex >= currentRoundData.matches.length) {
        setError('找不到要刪除的對戰');
        return;
      }

      const match = currentRoundData.matches[matchIndex];
      
      // 檢查是否已有比分結果
      if (match.winner_team_id) {
        setError('已有比分結果的對戰無法刪除');
        return;
      }

      // 如果對戰已保存到資料庫，需要從資料庫中刪除
      if (match.match_id) {
        setIsDeleting(true);
        setSaving(true);
        console.log(`開始刪除對戰，match_id: ${match.match_id}`);
        
        // 先刪除相關的 contest_match_detail 記錄
        const { error: detailDeleteError } = await supabase
          .from('contest_match_detail')
          .delete()
          .eq('match_id', match.match_id);

        if (detailDeleteError) {
          console.error('刪除比賽詳細記錄失敗:', detailDeleteError);
          // 不阻止繼續刪除主記錄，因為可能沒有詳細記錄
        }

        // 刪除主要的 contest_match 記錄
        const { error: matchDeleteError } = await supabase
          .from('contest_match')
          .delete()
          .eq('match_id', match.match_id);

        if (matchDeleteError) {
          console.error('刪除對戰記錄失敗:', matchDeleteError);
          setError('刪除對戰失敗');
          setSaving(false);
          return;
        }

        setSuccessMessage('對戰已從資料庫中刪除');
        setTimeout(() => setSuccessMessage(''), 3000);
      }

      // 從本地狀態中移除對戰
      setRounds(prev => {
        const updated = [...prev];
        const roundIndex = updated.findIndex(r => r.round_number === roundNumber);
        
        if (roundIndex >= 0) {
          // 創建新的 matches 數組，而不是直接修改原數組
          const newMatches = [...updated[roundIndex].matches];
          newMatches.splice(matchIndex, 1);
          
          // 重新排序 match_order
          newMatches.forEach((match, index) => {
            match.match_order = index + 1;
          });
          
          // 創建新的 round 對象
          updated[roundIndex] = {
            ...updated[roundIndex],
            matches: newMatches
          };
        }
        
        return updated;
      });

      // 重新計算隊伍狀態
      await fetchAllTeams();

    } catch (error) {
      console.error('刪除對戰失敗:', error);
      setError('刪除對戰失敗');
    } finally {
      setSaving(false);
      setIsDeleting(false);
    }
  };


  // 保存當前輪次到資料庫
  const saveCurrentRound = async () => {
    try {
      setSaving(true);
      setError('');

      const currentRoundData = rounds.find(r => r.round_number === currentRound);
      if (!currentRoundData) {
        throw new Error('找不到當前輪次資料');
      }

      // 獲取當前輪次已存在的比賽記錄
      const { data: existingMatches, error: fetchError } = await supabase
        .from('contest_match')
        .select('match_id, team1_id, team2_id, winner_team_id, match_order')
        .eq('contest_id', String(contestId))
        .eq('round', currentRound);

      if (fetchError) throw fetchError;

      // 準備要插入的新比賽記錄
      const matchesToInsert = [];
      const matchesToUpdate = [];

      currentRoundData.matches
        .filter(match => match.team1_id && match.team2_id) // 只處理已安排隊伍的比賽
        .forEach(match => {
          // 檢查是否已存在相同的比賽配對
          const existingMatch = existingMatches?.find(existing => 
            (existing.team1_id === match.team1_id && existing.team2_id === match.team2_id) ||
            (existing.team1_id === match.team2_id && existing.team2_id === match.team1_id)
          );

          if (existingMatch) {
            // 如果比賽已存在且沒有結果，可以更新
            if (!existingMatch.winner_team_id) {
              matchesToUpdate.push({
                match_id: existingMatch.match_id,
                team1_id: match.team1_id,
                team2_id: match.team2_id,
                match_order: match.match_order,
                status: match.status || 'pending',
                round_name: match.round_name || `第${match.round}輪`
              });
            }
            // 如果已有結果，則保持不變
          } else {
            // 新的比賽配對，需要插入
            matchesToInsert.push({
              contest_id: String(contestId),
              team1_id: match.team1_id,
              team2_id: match.team2_id,
              round: match.round,
              match_order: match.match_order,
              status: match.status || 'pending',
              round_name: match.round_name || `第${match.round}輪`
            });
          }
        });

      // 插入新比賽記錄
      let insertedMatches = [];
      if (matchesToInsert.length > 0) {
        const { data, error: insertError } = await supabase
          .from('contest_match')
          .insert(matchesToInsert)
          .select('match_id, team1_id, team2_id, round');

        if (insertError) throw insertError;
        insertedMatches = data || [];

        // 為每場新比賽創建 contest_match_detail 記錄
        if (insertedMatches.length > 0) {
          await createMatchDetailsForNewMatches(insertedMatches);
        }
      }

      // 更新現有比賽記錄（只更新沒有結果的）
      for (const matchUpdate of matchesToUpdate) {
        const { error: updateError } = await supabase
          .from('contest_match')
          .update({
            team1_id: matchUpdate.team1_id,
            team2_id: matchUpdate.team2_id,
            match_order: matchUpdate.match_order,
            status: matchUpdate.status,
            round_name: matchUpdate.round_name
          })
          .eq('match_id', matchUpdate.match_id);

        if (updateError) {
          console.error('更新比賽記錄失敗:', updateError);
        }
      }

      // 只有在有新增或更新比賽時才更新比賽狀態
      if (matchesToInsert.length > 0 || matchesToUpdate.length > 0) {
        // 更新比賽狀態為進行中
        const { error: updateError } = await supabase
          .from('contest')
          .update({ contest_status: 'ongoing' })
          .eq('contest_id', String(contestId));

        if (updateError) throw updateError;

        // 更新本地狀態
        if (contestData) {
          setContestData({
            ...contestData,
            contest_status: 'ongoing'
          });
        }
      }

      // 🔧 更新本地狀態中的 match_id，避免顯示未保存警告
      if (insertedMatches.length > 0) {
        setRounds(prev => {
          const updated = [...prev];
          const currentRoundIndex = updated.findIndex(r => r.round_number === currentRound);
          
          if (currentRoundIndex >= 0) {
            const updatedMatches = [...updated[currentRoundIndex].matches];
            
            // 為新插入的比賽更新 match_id
            insertedMatches.forEach(insertedMatch => {
              const matchIndex = updatedMatches.findIndex(match => 
                match.team1_id === insertedMatch.team1_id && 
                match.team2_id === insertedMatch.team2_id &&
                !match.match_id // 只更新沒有 match_id 的比賽
              );
              
              if (matchIndex >= 0) {
                updatedMatches[matchIndex] = {
                  ...updatedMatches[matchIndex],
                  match_id: insertedMatch.match_id
                };
                console.log(`更新本地狀態 match_id: ${insertedMatch.match_id} for match ${matchIndex}`);
              }
            });
            
            updated[currentRoundIndex] = {
              ...updated[currentRoundIndex],
              matches: updatedMatches
            };
          }
          
          return updated;
        });
      }

      setSuccessMessage('對戰安排已保存，比賽狀態已更新為進行中');
      setTimeout(() => setSuccessMessage(''), 3000);

      // 🔧 移除可能導致權限問題的重新獲取資料操作
      // 這些操作可能觸發 React 重新渲染，導致 ProtectedRoute 重新檢查權限
      // await fetchAllTeams();
      // await fetchExistingMatches();

    } catch (error) {
      console.error('保存失敗:', error);
      setError('保存對戰安排失敗');
    } finally {
      setSaving(false);
    }
  };

  // 獲取最大輪次數
  const getMaxRound = () => {
    return Math.max(...rounds.map(r => r.round_number), 0);
  };

  // 檢查當前輪次是否為最後一輪
  const isCurrentRoundTheLast = () => {
    const maxRound = getMaxRound();
    return currentRound === maxRound;
  };

  // 檢查當前輪次是否有未保存的變更
  const hasUnsavedChanges = () => {
    const currentRoundData = rounds.find(r => r.round_number === currentRound);
    if (!currentRoundData) return false;

    // 檢查是否有未保存到資料庫的比賽（包括空白對戰和已安排隊伍的對戰）
    return currentRoundData.matches.some(match => {
      // 如果比賽沒有 match_id，表示未保存到資料庫
      return !match.match_id;
    });
  };

  // 檢查當前輪次是否有已安排的對戰
  const hasArrangedMatches = () => {
    const currentRoundData = rounds.find(r => r.round_number === currentRound);
    if (!currentRoundData) return false;

    // 檢查是否有已安排隊伍的對戰
    return currentRoundData.matches.some(match => 
      match.team1_id && match.team2_id
    );
  };

  // 檢查當前輪次是否已完全保存
  const isCurrentRoundSaved = () => {
    const currentRoundData = rounds.find(r => r.round_number === currentRound);
    if (!currentRoundData) return true;

    // 如果沒有任何已安排的比賽，視為已保存
    const arrangedMatches = currentRoundData.matches.filter(match => 
      match.team1_id && match.team2_id
    );
    
    if (arrangedMatches.length === 0) return true;

    // 所有已安排的比賽都必須有 match_id（表示已保存到資料庫）
    return arrangedMatches.every(match => match.match_id);
  };

  // 檢查是否有已保存的對戰可以進入戰況室
  const hasSavedMatches = () => {
    return rounds.some(round => 
      round.matches.some(match => 
        match.match_id && match.team1_id && match.team2_id
      )
    );
  };

  // 檢查是否還有可用的隊伍可以安排新對戰
  const canAddMoreMatches = () => {
    const currentRoundData = rounds.find(r => r.round_number === currentRound);
    if (!currentRoundData) return true;

    // 統計已被安排的隊伍
    const assignedTeamIds = new Set<number>();
    currentRoundData.matches.forEach(match => {
      if (match.team1_id) assignedTeamIds.add(match.team1_id);
      if (match.team2_id) assignedTeamIds.add(match.team2_id);
    });

    // 計算還有多少隊伍未被安排
    const unassignedTeamsCount = allTeams.length - assignedTeamIds.size;
    
    // 至少需要2支隊伍才能組成一場新對戰
    return unassignedTeamsCount >= 2;
  };

  // 檢查當前輪次是否有未完成的對戰
  const hasIncompleteMatches = () => {
    const currentRoundData = rounds.find(r => r.round_number === currentRound);
    if (!currentRoundData) return false;

    // 檢查是否有已安排隊伍但沒有比分結果的對戰
    return currentRoundData.matches.some(match => 
      match.team1_id && match.team2_id && !match.winner_team_id
    );
  };
  
  // 檢查是否有任何未完成的對戰（所有輪次）
  const hasAnyIncompleteMatches = () => {
    return rounds.some(round => 
      round.matches.some(match => 
        match.team1_id && match.team2_id && !match.winner_team_id
      )
    );
  };
  
  // 檢查是否需要季軍戰
  const needsThirdPlaceMatch = () => {
    // 獲取晉級隊伍數量
    const advancementCount = contestData?.advancement_rules?.advancement_count || 0;
    
    // 如果需要晉級3隊或更多，且沒有季軍戰，則需要安排季軍戰
    if (advancementCount >= 3) {
      // 檢查是否已經有季軍戰
      const hasThirdPlaceMatch = rounds.some(round => 
        round.matches.some(match => 
          match.match_type === 'third_place' || match.ranking_match === 'third_place'
        )
      );
      
      if (!hasThirdPlaceMatch) {
        // 檢查是否已經進入決賽階段
        const maxRound = getMaxRound();
        const finalRound = rounds.find(r => r.round_number === maxRound);
        
        // 如果決賽只有一場比賽，且準決賽已完成，則需要安排季軍戰
        if (finalRound && finalRound.matches.length === 1) {
          const semifinalRound = rounds.find(r => r.round_number === maxRound - 1);
          if (semifinalRound && semifinalRound.matches.length >= 2) {
            const allSemifinalMatchesCompleted = semifinalRound.matches.every(match => 
              match.winner_team_id
            );
            
            if (allSemifinalMatchesCompleted) {
              return true;
            }
          }
        }
      }
    }
    
    return false;
  };
  
  // 獲取準決賽失敗者
  const getSemifinalLosers = () => {
    const maxRound = getMaxRound();
    if (maxRound <= 1) return [];
    
    const semifinalRound = rounds.find(r => r.round_number === maxRound - 1);
    if (!semifinalRound) return [];
    
    const losers: {teamId: number, teamName: string}[] = [];
    
    semifinalRound.matches.forEach(match => {
      if (match.winner_team_id && match.team1_id && match.team2_id) {
        const loserId = match.team1_id === match.winner_team_id ? match.team2_id : match.team1_id;
        const loserTeam = allTeams.find(t => t.contest_team_id === loserId);
        if (loserTeam) {
          losers.push({
            teamId: loserId,
            teamName: loserTeam.team_name
          });
        }
      }
    });
    
    return losers;
  };
  
  // 創建季軍戰
  const createThirdPlaceMatch = async () => {
    try {
      setSaving(true);
      setError('');
      
      // 獲取準決賽失敗者
      const losers = getSemifinalLosers();
      if (losers.length !== 2) {
        setError('無法創建季軍戰：找不到準確的兩支準決賽失敗隊伍');
        return false;
      }
      
      // 獲取最大輪次
      const maxRound = getMaxRound();
      
      // 創建季軍戰記錄
      const thirdPlaceMatch = {
        contest_id: String(contestId),
        team1_id: losers[0].teamId,
        team2_id: losers[1].teamId,
        round: maxRound, // 與決賽同輪次
        match_order: 2, // 決賽後的第二場比賽
        status: 'pending',
        match_type: 'third_place',
        ranking_match: 'third_place',
        match_description: '季軍戰（第3、4名）'
      };
      
      // 插入季軍戰記錄
      const { data: insertedMatch, error: insertError } = await supabase
        .from('contest_match')
        .insert([thirdPlaceMatch])
        .select('match_id, team1_id, team2_id, round');
      
      if (insertError) {
        console.error('創建季軍戰失敗:', insertError);
        setError('創建季軍戰失敗');
        return false;
      }
      
      // 為季軍戰創建比賽詳情記錄
      if (insertedMatch && insertedMatch.length > 0) {
        await createMatchDetailsForNewMatches(insertedMatch);
      }
      
      setSuccessMessage('季軍戰已創建，請前往戰況室進行比分錄入');
      setTimeout(() => setSuccessMessage(''), 3000);
      
      // 重新載入比賽資料
      await fetchExistingMatches();
      
      return true;
    } catch (error) {
      console.error('創建季軍戰失敗:', error);
      setError('創建季軍戰失敗');
      return false;
    } finally {
      setSaving(false);
    }
  };
  
  // 檢查是否可以結束比賽
  const canFinishContest = () => {
    // 1. 檢查是否有未完成的比賽
    if (hasAnyIncompleteMatches()) {
      return { canFinish: false, reason: "還有未完成的比賽，請先完成所有比賽" };
    }
    
    // 2. 檢查晉級隊伍數量
    const advancementCount = contestData?.advancement_rules?.advancement_count || 0;
    
    if (advancementCount > 0) {
      // 檢查是否需要季軍戰但尚未創建
      if (needsThirdPlaceMatch()) {
        return { 
          canFinish: false, 
          reason: `需要晉級${advancementCount}支隊伍，請先創建季軍戰以確定第3名` 
        };
      }
      
      // 檢查是否有足夠的晉級隊伍
      // 這裡需要調用後端API來計算，但為了簡化，我們假設如果所有比賽都完成，晉級隊伍就足夠
    }
    
    return { canFinish: true, reason: "" };
  };

  // 結束當前輪次，生成下一輪
  const finishCurrentRound = async () => {
    console.log('finishCurrentRound 開始執行');
    console.log('當前用戶:', user);
    console.log('contestId:', contestId);
    
    // 🔧 保存用戶狀態，防止在執行過程中丟失
    const currentUser = JSON.parse(localStorage.getItem('loginUser') || '{}');
    console.log('重新獲取用戶狀態:', currentUser);
    
    // 檢查用戶登入狀態
    if (!currentUser || !currentUser.member_id) {
      console.error('用戶未登入或登入狀態失效');
      setError('登入狀態失效，請重新登入');
      return;
    }

    // 檢查是否為最後一輪
    if (!isCurrentRoundTheLast()) {
      setError('只能結束最後一輪！請先切換到最後一輪。');
      return;
    }

    // 檢查當前輪次是否有未完成的對戰
    console.log('檢查是否有未完成的對戰...');
    const hasIncomplete = hasIncompleteMatches();
    console.log('hasIncompleteMatches 結果:', hasIncomplete);
    
    if (hasIncomplete) {
      console.log('發現未完成的對戰，阻止新增下一輪');
      setError(`第${currentRound}輪比賽未結束，無法新增下一輪。請先完成所有對戰的比分錄入。`);
      return;
    } else {
      console.log('沒有未完成的對戰，可以繼續');
    }

    try {
      console.log('開始執行新增下一輪操作');
      setSaving(true);
      setError('');

      // 🔧 在關鍵操作前再次確認用戶狀態
      const userCheck = JSON.parse(localStorage.getItem('loginUser') || '{}');
      if (!userCheck || !userCheck.member_id) {
        throw new Error('用戶狀態在執行過程中丟失');
      }

      // 先保存當前輪次
      console.log('保存當前輪次...');
      await saveCurrentRound();

      // 🔧 保存完成後再次檢查用戶狀態
      const userCheckAfterSave = JSON.parse(localStorage.getItem('loginUser') || '{}');
      if (!userCheckAfterSave || !userCheckAfterSave.member_id) {
        console.error('用戶狀態在保存後丟失');
        throw new Error('用戶狀態在保存過程中丟失');
      }

      // 創建下一輪
      const nextRound = currentRound + 1;
      console.log('創建下一輪:', nextRound);
      await createEmptyRound(nextRound);

      console.log('新增下一輪完成');
      setSuccessMessage(`第${currentRound}輪已結束，已生成第${nextRound}輪`);
      setTimeout(() => setSuccessMessage(''), 3000);

    } catch (error) {
      console.error('結束輪次失敗:', error);
      setError(`結束輪次失敗: ${error.message || error}`);
      
      // 🔧 錯誤發生時檢查用戶狀態
      const userCheckOnError = JSON.parse(localStorage.getItem('loginUser') || '{}');
      console.log('錯誤時的用戶狀態:', userCheckOnError);
    } finally {
      console.log('finishCurrentRound 執行完成');
      setSaving(false);
    }
  };

  // 🆕 重新計算排名（不改變比賽狀態）
  const refreshRankings = async () => {
    try {
      setSaving(true);
      setError('');
      
      console.log('🔄 開始重新計算排名...');
      
      // 🆕 使用 contestFinishAndAdvancement.ts 中的 finishContest 函數重新計算排名
      // 但不改變比賽狀態為 finished
      const qualifiedTeams = await finishContestUtil(String(contestId));
      
      console.log('✅ 排名重新計算完成，晉級隊伍:', qualifiedTeams);
      setSuccessMessage(`排名已重新計算，${qualifiedTeams.length} 支隊伍晉級`);
      
      setTimeout(() => setSuccessMessage(''), 3000);
      
    } catch (error) {
      console.error('重新計算排名失敗:', error);
      setError(`重新計算排名失敗: ${error.message || error}`);
    } finally {
      setSaving(false);
    }
  };

  // 結束整個比賽
  const finishContest = async () => {
    try {
      // 再次檢查是否可以結束比賽
      const finishStatus = canFinishContest();
      if (!finishStatus.canFinish) {
        setError(finishStatus.reason);
        return;
      }
      
      setSaving(true);
      setError('');

      // 先保存當前輪次
      await saveCurrentRound();

      // 🆕 使用 contestFinishAndAdvancement.ts 中的 finishContest 函數
      // 這會計算晉級隊伍並更新 advancement_rules 欄位
      console.log('🏆 開始結束比賽並計算晉級隊伍...');
      const qualifiedTeams = await finishContestUtil(String(contestId));
      
      console.log('✅ 比賽結束成功，晉級隊伍:', qualifiedTeams);
      setSuccessMessage(`比賽已結束，${qualifiedTeams.length} 支隊伍晉級`);
      
      setTimeout(() => {
        navigate(`/contest/${contestId}/results`);
      }, 2000);

    } catch (error) {
      console.error('結束比賽失敗:', error);
      setError(`結束比賽失敗: ${error.message || error}`);
    } finally {
      setSaving(false);
    }
  };
  
  // 處理結束比賽按鈕點擊
  const handleFinishContest = () => {
    // 最終確認
    const confirm = window.confirm('確定要結束比賽嗎？結束後將無法再修改比賽結果。');
    if (confirm) {
      finishContest();
    }
  };

  // 獲取隊伍顯示名稱
  const getTeamDisplayName = (teamId: number | null): string => {
    console.log(`🔍 getTeamDisplayName 被調用，teamId: ${teamId}`);
    
    if (!teamId) {
      console.log(`❌ teamId 為空，返回空字符串`);
      return '';
    }
    
    // 優先從 allTeams 中查找
    const team = allTeams.find(t => t.contest_team_id === teamId);
    if (team) {
      console.log(`✅ 從 allTeams 找到隊伍: ${team.team_name} (ID: ${teamId})`);
      return team.team_name;
    }
    
    // 其次從緩存中查找
    const cachedName = teamNameCache.get(teamId);
    if (cachedName) {
      console.log(`✅ 從緩存獲取隊伍名稱: ${cachedName} (ID: ${teamId})`);
      return cachedName;
    }
    
    // 🔍 當都找不到時，記錄並返回臨時顯示
    console.warn(`⚠️ 找不到隊伍名稱 - teamId: ${teamId}`);
    console.log(`📊 當前 allTeams 數量: ${allTeams.length}`);
    console.log(`📋 allTeams 中的 team_id 列表:`, allTeams.map(t => t.contest_team_id));
    console.log(`💾 當前緩存的隊伍數量: ${teamNameCache.size}`);
    console.log(`💾 緩存中的隊伍IDs: [${Array.from(teamNameCache.keys()).join(', ')}]`);
    
    // 異步查詢隊伍名稱（但不阻塞當前返回）
    console.log(`🔄 開始異步查詢隊伍名稱，teamId: ${teamId}`);
    fetchTeamNameFromDatabase(teamId);
    
    console.log(`⏳ 返回臨時顯示: 隊伍${teamId}`);
    return `隊伍${teamId}`; // 臨時顯示，等待異步查詢完成
  };

  // 隊伍名稱緩存 - 🔧 修復：使用組件外部的持久化緩存，避免登出登入後重置
  const teamNameCache = React.useMemo(() => {
    // 嘗試從 sessionStorage 恢復緩存
    const cacheKey = `teamNameCache_${contestId}`;
    try {
      const savedCache = sessionStorage.getItem(cacheKey);
      if (savedCache) {
        const parsedCache = JSON.parse(savedCache);
        console.log(`🔄 從 sessionStorage 恢復隊伍名稱緩存，數量: ${Object.keys(parsedCache).length}`);
        return new Map(Object.entries(parsedCache).map(([k, v]) => [parseInt(k), v as string]));
      }
    } catch (error) {
      console.warn('恢復隊伍名稱緩存失敗:', error);
    }
    return new Map<number, string>();
  }, [contestId]);

  // 保存緩存到 sessionStorage
  const saveTeamNameCache = () => {
    try {
      const cacheKey = `teamNameCache_${contestId}`;
      const cacheObject = Object.fromEntries(teamNameCache.entries());
      sessionStorage.setItem(cacheKey, JSON.stringify(cacheObject));
      console.log(`💾 已保存隊伍名稱緩存到 sessionStorage，數量: ${teamNameCache.size}`);
    } catch (error) {
      console.warn('保存隊伍名稱緩存失敗:', error);
    }
  };

  // 🔧 主動修復隊伍名稱顯示問題
  const proactiveTeamNameFix = async () => {
    console.log('🔧 開始主動修復隊伍名稱顯示問題...');
    
    // 收集所有比賽中使用的隊伍ID
    const allUsedTeamIds = new Set<number>();
    rounds.forEach(round => {
      round.matches.forEach(match => {
        if (match.team1_id) allUsedTeamIds.add(match.team1_id);
        if (match.team2_id) allUsedTeamIds.add(match.team2_id);
        if (match.winner_team_id) allUsedTeamIds.add(match.winner_team_id);
      });
    });

    // 檢查哪些隊伍ID需要修復（不在 allTeams 中且不在緩存中）
    const availableTeamIds = new Set(allTeams.map(t => t.contest_team_id));
    const cachedTeamIds = new Set(teamNameCache.keys());
    
    const needFixTeamIds = Array.from(allUsedTeamIds).filter(id => 
      !availableTeamIds.has(id) && !cachedTeamIds.has(id)
    );

    if (needFixTeamIds.length > 0) {
      console.log(`🔧 發現 ${needFixTeamIds.length} 個需要修復的隊伍ID:`, needFixTeamIds);
      
      // 批量查詢並修復
      await batchFetchMissingTeamNames(needFixTeamIds);
      
      console.log('✅ 主動修復完成');
    } else {
      console.log('✅ 沒有需要修復的隊伍名稱');
    }
  };

  // 從資料庫查詢隊伍名稱
  const fetchTeamNameFromDatabase = async (teamId: number) => {
    try {
      // 如果已經在緩存中，直接返回
      if (teamNameCache.has(teamId)) {
        console.log(`💾 隊伍 ${teamId} 已在緩存中，直接返回: ${teamNameCache.get(teamId)}`);
        return teamNameCache.get(teamId);
      }

      console.log(`🔍 開始從資料庫查詢隊伍名稱，team_id: ${teamId}`);
      
      // 🔧 修復：同時從兩個表查詢隊伍名稱
      // 先從 contest_team 表查詢
      const { data: directTeam, error: directError } = await supabase
        .from('contest_team')
        .select('team_name')
        .eq('contest_team_id', teamId)
        .single();

      if (!directError && directTeam) {
        console.log(`✅ 從 contest_team 表查詢到隊伍名稱: ${directTeam.team_name} (ID: ${teamId})`);
        // 緩存結果
        teamNameCache.set(teamId, directTeam.team_name);
        
        // 🔧 保存緩存到 sessionStorage
        saveTeamNameCache();
        
        // 觸發重新渲染以更新顯示
        setAllTeams(prev => [...prev]); // 觸發狀態更新
        
        // 🔧 觸發比分摘要更新
        setTimeout(() => {
          setRounds(prev => [...prev]); // 觸發比分摘要重新計算
        }, 50);
        
        return directTeam.team_name;
      }

      // 如果在 contest_team 表中找不到，再從 contest_group_assignment 表查詢
      console.log(`🔍 在 contest_team 表中未找到，嘗試從 contest_group_assignment 表查詢，team_id: ${teamId}`);
      
      const { data: assignedTeam, error: assignedError } = await supabase
        .from('contest_group_assignment')
        .select('team_name')
        .eq('contest_team_id', teamId)
        .single();

      if (!assignedError && assignedTeam) {
        console.log(`✅ 從 contest_group_assignment 表查詢到隊伍名稱: ${assignedTeam.team_name} (ID: ${teamId})`);
        // 緩存結果
        teamNameCache.set(teamId, assignedTeam.team_name);
        
        // 🔧 保存緩存到 sessionStorage
        saveTeamNameCache();
        
        // 觸發重新渲染以更新顯示
        setAllTeams(prev => [...prev]); // 觸發狀態更新
        
        // 🔧 觸發比分摘要更新
        setTimeout(() => {
          setRounds(prev => [...prev]); // 觸發比分摘要重新計算
        }, 50);
        
        return assignedTeam.team_name;
      }

      console.error(`❌ 在兩個表中都找不到隊伍名稱，team_id: ${teamId}`);
      return `隊伍${teamId}`;
    } catch (error) {
      console.error(`❌ 查詢隊伍名稱時發生錯誤，team_id: ${teamId}`, error);
      return `隊伍${teamId}`;
    }
  };

  // 獲取隊伍狀態顏色和標籤
  const getTeamStatusStyle = (team: TeamData) => {
    switch (team.status) {
      case 'unassigned':
        return { color: '#4caf50', label: '🟢' }; // 綠色
      case 'advanced':
        return { color: '#2196f3', label: '🔵' }; // 藍色
      case 'eliminated':
        return { color: '#f44336', label: '🔴' }; // 紅色
      case 'current_round':
        return { color: '#ff9800', label: '🟡' }; // 黃色
      default:
        return { color: '#666', label: '⚪' };
    }
  };

  // 檢查隊伍在當前輪次是否已被安排到其他比賽
  const isTeamAlreadyAssignedInRound = (teamId: number, roundNumber: number, excludeMatchIndex?: number): boolean => {
    const currentRoundData = rounds.find(r => r.round_number === roundNumber);
    if (!currentRoundData) return false;

    return currentRoundData.matches.some((match, index) => {
      // 排除當前正在編輯的比賽
      if (excludeMatchIndex !== undefined && index === excludeMatchIndex) return false;
      
      return match.team1_id === teamId || match.team2_id === teamId;
    });
  };


  // 初始化
  useEffect(() => {
    if (contestId) {
      fetchContestData().finally(() => setLoading(false));
    }
  }, [contestId]);

  if (loading) {
    return <div className="loading">載入中...</div>;
  }

  if (!contestData) {
    return <div className="error-message">找不到比賽資料</div>;
  }

  return (
    <div className="tournament-bracket-page">
      <h1>{contestData.contest_name} - 淘汰賽管理</h1>
      
      {error && <div className="error-message">{error}</div>}
      {successMessage && <div className="success-message">{successMessage}</div>}
      {hasUnsavedChanges() && (
        <div className="warning-message">
          ⚠️ 當前輪次有未保存的對戰安排，請先點擊「保存對戰安排」按鈕
        </div>
      )}
      {!canAddMoreMatches() && allTeams.length > 0 && (
        <div className="info-message">
          ℹ️ 當前輪次所有隊伍都已安排完畢，無法新增更多對戰
        </div>
      )}

      {/* 控制按鈕 */}
      <div className="bracket-controls">
        <button 
          onClick={saveCurrentRound} 
          disabled={saving || !hasArrangedMatches()}
          className={`save-btn ${hasUnsavedChanges() ? 'save-btn-urgent' : ''}`}
          title={
            !hasArrangedMatches() 
              ? '當前輪次沒有已安排的對戰，無需保存' 
              : hasUnsavedChanges() 
                ? '有未保存的對戰安排，請點擊保存' 
                : '保存當前輪次的對戰安排'
          }
        >
          {saving ? '保存中...' : hasUnsavedChanges() ? '⚠️ 保存對戰安排' : '保存對戰安排'}
        </button>
        
        <button 
          onClick={addMatchToCurrentRound}
          disabled={!canAddMoreMatches() || isAddingMatch}
          className="add-match-btn"
          title={!canAddMoreMatches() ? '當前輪次所有隊伍都已安排，無法新增更多對戰' : '新增對戰'}
        >
          {isAddingMatch ? '新增中...' : '新增對戰'}
        </button>
        
        <button 
          onClick={finishCurrentRound}
          disabled={saving || !isCurrentRoundTheLast() || !isCurrentRoundSaved() || hasUnsavedChanges() || hasIncompleteMatches()}
          className="finish-round-btn"
          title={
            !isCurrentRoundTheLast() 
              ? '只能在最後一輪新增下一輪' 
              : hasUnsavedChanges()
                ? '請先保存當前輪次的對戰安排'
              : !isCurrentRoundSaved() 
                ? '請先保存當前輪次的對戰安排'
              : hasIncompleteMatches()
                ? '當前輪次有未完成的對戰，請先完成所有比分錄入'
                : '新增下一輪比賽'
          }
        >
          新增下一輪
        </button>
        
        {needsThirdPlaceMatch() && (
          <button 
            onClick={createThirdPlaceMatch}
            disabled={saving}
            className="create-third-place-btn"
            title="創建季軍戰以確定第3、4名"
          >
            創建季軍戰
          </button>
        )}
        
        <button 
          onClick={handleFinishContest}
          disabled={saving || !canFinishContest().canFinish}
          className="finish-contest-btn"
          title={canFinishContest().reason || "結束比賽並確定最終排名"}
        >
          結束比賽
        </button>
        
        <button 
          onClick={() => navigate(`/contest/${contestId}/results`)}
          className="view-results-btn"
        >
          查看結果
        </button>
        
        <button 
          onClick={refreshRankings}
          disabled={saving}
          className="refresh-rankings-btn"
          title="刷新結果並重新計算排名（適用於更新排名邏輯後）"
        >
          {saving ? '計算中...' : '刷新結果'}
        </button>
        
        {!canFinishContest().canFinish && (
          <div className="warning-message">
            ⚠️ {canFinishContest().reason}
          </div>
        )}
        
        {hasSavedMatches() && (
          <button 
            onClick={() => navigate(`/contest/${contestId}/battleroom`)}
            className="battleroom-btn"
            title="進入戰況室進行比分錄入"
          >
            進入戰況室
          </button>
        )}
      </div>

      {/* 輪次選擇 */}
      <div className="round-selector">
        <label>當前輪次：</label>
        <select 
          value={currentRound} 
          onChange={(e) => setCurrentRound(parseInt(e.target.value))}
        >
          {rounds.map(round => (
            <option key={round.round_number} value={round.round_number}>
              {round.round_name}
            </option>
          ))}
        </select>
      </div>

      {/* 當前輪次對戰列表 */}
      <div className="current-round-matches">
        <h2>第{currentRound}輪對戰</h2>
        
        {rounds.find(r => r.round_number === currentRound)?.matches.length === 0 ? (
          <div className="no-matches-message">
            <p>🎯 當前輪次還沒有對戰安排</p>
            <p>點擊「新增對戰」按鈕來創建第一場對戰</p>
            {allTeams.length === 0 && (
              <div style={{ marginTop: '10px', padding: '10px', backgroundColor: '#fff3cd', borderRadius: '4px' }}>
                <p>⚠️ 沒有找到隊伍資料</p>
                <p>請確認：</p>
                <ul style={{ textAlign: 'left', margin: '5px 0' }}>
                  <li>子賽事是否已正確分配隊伍</li>
                  <li>是否有權限查看此子賽事</li>
                  <li>子賽事ID是否正確</li>
                </ul>
              </div>
            )}
          </div>
        ) : (
          rounds.find(r => r.round_number === currentRound)?.matches.map((match, index) => (
          <div key={match.match_id || `temp-${index}-${match.round}-${match.match_order}`} className="match-row">
            <div className="match-info">
              <span className="match-label">對戰 {index + 1}：</span>
            </div>
            
            <div className="team-selectors">
              {/* 隊伍1選擇 */}
              <select 
                value={match.team1_id || ''} 
                onChange={(e) => updateMatchTeam(currentRound, index, 'team1', e.target.value ? parseInt(e.target.value) : null)}
                className="team-selector"
              >
                <option value="">選擇隊伍1</option>
                {allTeams.map(team => {
                  const style = getTeamStatusStyle(team);
                  // 防呆檢查
                  const isSameAsTeam2 = team.contest_team_id === match.team2_id;
                  const isAlreadyAssigned = isTeamAlreadyAssignedInRound(team.contest_team_id, currentRound, index);
                  const isDisabled = isSameAsTeam2 || isAlreadyAssigned;
                  
                  let disabledReason = '';
                  if (isSameAsTeam2) {
                    disabledReason = ' (已選為對手)';
                  } else if (isAlreadyAssigned) {
                    disabledReason = ' (本輪已安排)';
                  }
                  
                  return (
                    <option 
                      key={team.contest_team_id} 
                      value={team.contest_team_id}
                      disabled={isDisabled}
                      style={isDisabled ? { color: '#ccc', backgroundColor: '#f5f5f5' } : {}}
                    >
                      {style.label} {team.team_name} ({team.source_info})
                      {disabledReason}
                    </option>
                  );
                })}
              </select>
              
              <span className="vs-label">VS</span>
              
              {/* 隊伍2選擇 */}
              <select 
                value={match.team2_id || ''} 
                onChange={(e) => updateMatchTeam(currentRound, index, 'team2', e.target.value ? parseInt(e.target.value) : null)}
                className="team-selector"
              >
                <option value="">選擇隊伍2</option>
                {allTeams.map(team => {
                  const style = getTeamStatusStyle(team);
                  // 防呆檢查
                  const isSameAsTeam1 = team.contest_team_id === match.team1_id;
                  const isAlreadyAssigned = isTeamAlreadyAssignedInRound(team.contest_team_id, currentRound, index);
                  const isDisabled = isSameAsTeam1 || isAlreadyAssigned;
                  
                  let disabledReason = '';
                  if (isSameAsTeam1) {
                    disabledReason = ' (已選為對手)';
                  } else if (isAlreadyAssigned) {
                    disabledReason = ' (本輪已安排)';
                  }
                  
                  return (
                    <option 
                      key={team.contest_team_id} 
                      value={team.contest_team_id}
                      disabled={isDisabled}
                      style={isDisabled ? { color: '#ccc', backgroundColor: '#f5f5f5' } : {}}
                    >
                      {style.label} {team.team_name} ({team.source_info})
                      {disabledReason}
                    </option>
                  );
                })}
              </select>
            </div>
            
            <div className="match-status">
              <span className={`status-badge status-${match.status}`}>
                {match.score_summary}
              </span>
            </div>
            
            {/* 刪除按鈕 - 只有在沒有比分結果時才顯示 */}
            <div className="match-actions">
              {!match.winner_team_id && (
                <button
                  onClick={() => deleteMatch(currentRound, index)}
                  disabled={saving || isDeleting}
                  className="delete-match-btn"
                  title="刪除此對戰"
                >
                  🗑️
                </button>
              )}
            </div>
          </div>
          ))
        )}
      </div>

      {/* 隊伍狀態說明 */}
      <div className="team-status-legend">
        <h3>隊伍狀態說明</h3>
        <div className="legend-items">
          <span className="legend-item">🟢 未安排隊伍</span>
          <span className="legend-item">🔵 晉級隊伍</span>
          <span className="legend-item">🔴 淘汰隊伍</span>
          <span className="legend-item">🟡 本輪已安排</span>
        </div>
      </div>

      {/* 所有輪次概覽 */}
      <div className="rounds-overview">
        <h3>所有輪次概覽</h3>
        {rounds.map(round => (
          <div key={round.round_number} className="round-summary">
            <h4>{round.round_name} ({round.matches.length} 場對戰)</h4>
            <div className="round-matches-summary">
              {round.matches.map((match, index) => (
                <div key={match.match_id || `summary-${index}-${match.round}-${match.match_order}`} className="match-summary">
                  <span className="teams">
                    {getTeamDisplayName(match.team1_id)} vs {getTeamDisplayName(match.team2_id)}
                  </span>
                  <span className={`status status-${match.status}`}>
                    {match.score_summary}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default TournamentBracketPage;