import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";
import './TournamentBracketPage.css';

// 類型定義
interface TeamData {
  contest_team_id: number;
  team_name: string;
  captain_name?: string;
}

interface MatchData {
  team1Id: number | null;
  team2Id: number | null;
  winnerId: number | null;
  nextMatchPosition: number | null;
  nextMatchTeamSlot: number | null;
  position: number;
}

interface RoundData {
  round: number;
  matches: MatchData[];
}

interface GroupData {
  id: string;
  name: string;
  teams: number[];
  bracket: RoundData[];
  qualified_teams?: number[];
}

interface BracketStructure {
  rounds?: RoundData[];
  groups?: { [groupId: string]: GroupData };
  seeds?: {
    team_ids: number[];
    distribution?: { [groupId: string]: number[] };
  };
  final_stage?: {
    bracket: RoundData[];
    team_mapping?: { [position: string]: { from_group: string; rank: number } };
  };
}

interface TournamentMode {
  value: string;
  label: string;
  description: string;
  recommended: boolean;
  rounds?: number;
  seedCount?: number;
  groupSizes?: number[];
}

interface SmartOptions {
  totalTeams: number;
  actualTeams: number;
  playersPerTeam: number;
  recommendedModes: TournamentMode[];
  seedOptions: { count: number; label: string; optimal: boolean }[];
  groupOptions: number[][];
}

const TournamentBracketPage: React.FC = () => {
  const { contestId } = useParams<{ contestId: string }>();
  const navigate = useNavigate();
  
  // 基本狀態
  const [contestData, setContestData] = useState<any>(null);
  const [teams, setTeams] = useState<TeamData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [saving, setSaving] = useState(false);
  
  // 拖曳相關狀態
  const [draggedTeam, setDraggedTeam] = useState<TeamData | null>(null);
  
  // 配置精靈狀態
  const [showConfigWizard, setShowConfigWizard] = useState(false);
  const [configStep, setConfigStep] = useState(1);
  const [selectedMode, setSelectedMode] = useState<string>('');
  const [selectedSeeds, setSelectedSeeds] = useState<number>(0);
  const [smartOptions, setSmartOptions] = useState<SmartOptions | null>(null);
  const [bracketStructure, setBracketStructure] = useState<BracketStructure | null>(null);
  
  // 獲取登錄用戶信息
  const user = JSON.parse(localStorage.getItem('loginUser') || '{}');
  
  // 智能推薦邏輯
  const calculateRecommendedModes = (actualTeams: number, expectedTeams: number): TournamentMode[] => {
    const modes: TournamentMode[] = [];
    const totalTeams = Math.max(actualTeams, expectedTeams);
    
    // 標準淘汰賽
    modes.push({
      value: 'elimination',
      label: '標準淘汰賽',
      description: `${totalTeams}隊直接淘汰`,
      recommended: totalTeams <= 16,
      rounds: Math.ceil(Math.log2(Math.max(totalTeams, 2)))
    });
    
    // 種子淘汰賽
    if (totalTeams >= 8) {
      modes.push({
        value: 'group_elimination_1',
        label: '種子淘汰賽',
        description: `${totalTeams}隊 + 種子保護`,
        recommended: totalTeams >= 16,
        seedCount: Math.min(8, Math.floor(totalTeams / 2))
      });
    }
    
    // 雙組淘汰賽
    if (totalTeams >= 6) {
      const groupA = Math.ceil(totalTeams / 2);
      const groupB = Math.floor(totalTeams / 2);
      
      modes.push({
        value: 'group_elimination_2',
        label: '雙組淘汰賽',
        description: `A組${groupA}隊 vs B組${groupB}隊`,
        recommended: totalTeams >= 12 && totalTeams <= 32,
        groupSizes: [groupA, groupB]
      });
    }
    
    return modes;
  };
  
  const calculateSeedOptions = (totalTeams: number) => {
    const options = [];
    
    if (totalTeams >= 4) options.push({ count: 4, label: '4個種子', optimal: totalTeams <= 16 });
    if (totalTeams >= 8) options.push({ count: 8, label: '8個種子', optimal: totalTeams > 16 && totalTeams <= 32 });
    if (totalTeams >= 16) options.push({ count: 16, label: '16個種子', optimal: totalTeams > 32 });
    
    return options;
  };
  
  // 獲取智能選項
  const getSmartOptions = (contestData: any, actualTeamCount: number): SmartOptions => {
    const expectedTeams = contestData?.expected_teams || 0;
    const playersPerTeam = contestData?.players_per_team || 5;
    
    return {
      totalTeams: expectedTeams,
      actualTeams: actualTeamCount,
      playersPerTeam,
      recommendedModes: calculateRecommendedModes(actualTeamCount, expectedTeams),
      seedOptions: calculateSeedOptions(Math.max(actualTeamCount, expectedTeams)),
      groupOptions: []
    };
  };
  
  // 獲取比賽結果
  const fetchMatchResults = async () => {
    try {
      // 獲取所有比賽記錄
      const { data: matchesData, error: matchesError } = await supabase
        .from('contest_match')
        .select(`
          match_id,
          team1_id,
          team2_id,
          round,
          contest_match_detail (
            winner_team_id,
            match_type,
            sequence
          )
        `)
        .eq('contest_id', contestId);

      if (matchesError) throw matchesError;

      return matchesData || [];
    } catch (error) {
      console.error('獲取比賽結果失敗:', error);
      return [];
    }
  };

  // 計算比賽獲勝者
  const calculateMatchWinner = (matchDetails: any[]) => {
    if (!matchDetails || matchDetails.length === 0) return null;

    // 統計各隊獲勝場次
    const winCounts: { [key: string]: number } = {};
    
    matchDetails.forEach(detail => {
      if (detail.winner_team_id) {
        winCounts[detail.winner_team_id] = (winCounts[detail.winner_team_id] || 0) + 1;
      }
    });

    // 找出獲勝最多場次的隊伍
    let maxWins = 0;
    let winnerTeamId = null;

    Object.entries(winCounts).forEach(([teamId, wins]) => {
      if (wins > maxWins) {
        maxWins = wins;
        winnerTeamId = parseInt(teamId);
      }
    });

    return winnerTeamId;
  };

  // 更新賽制結構中的獲勝者和晉級
  const updateBracketWithResults = (
    currentBracket: BracketStructure, 
    matchResults: any[]
  ): BracketStructure => {
    const updatedBracket = JSON.parse(JSON.stringify(currentBracket));

    // 處理標準淘汰賽和種子淘汰賽
    if (updatedBracket.rounds) {
      matchResults.forEach(match => {
        const winnerId = calculateMatchWinner(match.contest_match_detail);
        
        // 找到對應的比賽並更新獲勝者
        updatedBracket.rounds.forEach((round: RoundData, roundIndex: number) => {
          round.matches.forEach((bracketMatch: MatchData) => {
            if (bracketMatch.team1Id === match.team1_id && 
                bracketMatch.team2Id === match.team2_id) {
              
              bracketMatch.winnerId = winnerId;
              
              // 晉級到下一輪
              if (winnerId && bracketMatch.nextMatchPosition && bracketMatch.nextMatchTeamSlot) {
                const nextRoundIndex = roundIndex + 1;
                if (nextRoundIndex < updatedBracket.rounds.length) {
                  const nextMatch = updatedBracket.rounds[nextRoundIndex].matches.find(
                    (m: MatchData) => m.position === bracketMatch.nextMatchPosition
                  );
                  
                  if (nextMatch) {
                    if (bracketMatch.nextMatchTeamSlot === 1) {
                      nextMatch.team1Id = winnerId;
                    } else {
                      nextMatch.team2Id = winnerId;
                    }
                  }
                }
              }
            }
          });
        });
      });
    }

    // 處理雙組淘汰賽
    if (updatedBracket.groups) {
      Object.keys(updatedBracket.groups).forEach(groupId => {
        const group = updatedBracket.groups[groupId];
        
        matchResults.forEach(match => {
          const winnerId = calculateMatchWinner(match.contest_match_detail);
          
          group.bracket.forEach((round: RoundData, roundIndex: number) => {
            round.matches.forEach((bracketMatch: MatchData) => {
              if (bracketMatch.team1Id === match.team1_id && 
                  bracketMatch.team2Id === match.team2_id) {
                
                bracketMatch.winnerId = winnerId;
                
                // 組內晉級
                if (winnerId && bracketMatch.nextMatchPosition && bracketMatch.nextMatchTeamSlot) {
                  const nextRoundIndex = roundIndex + 1;
                  if (nextRoundIndex < group.bracket.length) {
                    const nextMatch = group.bracket[nextRoundIndex].matches.find(
                      (m: MatchData) => m.position === bracketMatch.nextMatchPosition
                    );
                    
                    if (nextMatch) {
                      if (bracketMatch.nextMatchTeamSlot === 1) {
                        nextMatch.team1Id = winnerId;
                      } else {
                        nextMatch.team2Id = winnerId;
                      }
                    }
                  } else {
                    // 組冠軍，晉級到決賽階段
                    if (updatedBracket.final_stage && updatedBracket.final_stage.bracket.length > 0) {
                      const finalMatch = updatedBracket.final_stage.bracket[0].matches[0];
                      if (groupId === 'A') {
                        finalMatch.team1Id = winnerId;
                      } else if (groupId === 'B') {
                        finalMatch.team2Id = winnerId;
                      }
                    }
                  }
                }
              }
            });
          });
        });
      });

      // 處理決賽階段
      if (updatedBracket.final_stage) {
        matchResults.forEach(match => {
          const winnerId = calculateMatchWinner(match.contest_match_detail);
          
          updatedBracket.final_stage.bracket.forEach((round: RoundData) => {
            round.matches.forEach((bracketMatch: MatchData) => {
              if (bracketMatch.team1Id === match.team1_id && 
                  bracketMatch.team2Id === match.team2_id) {
                bracketMatch.winnerId = winnerId;
              }
            });
          });
        });
      }
    }

    return updatedBracket;
  };
  
  // 獲取比賽資料
  const [matchResults, setMatchResults] = useState<any[]>([]);
  
  const getMatchResult = (team1Id: number | null, team2Id: number | null, matchResults: any[]) => {
    if (!team1Id || !team2Id) return null;
    
    const matchData = matchResults.find(match => 
      (match.team1_id === team1Id && match.team2_id === team2Id) ||
      (match.team1_id === team2Id && match.team2_id === team1Id)
    );
    
    if (!matchData || !matchData.contest_match_detail || matchData.contest_match_detail.length === 0) {
      return null;
    }
    
    // 統計比分
    const team1Wins = matchData.contest_match_detail.filter(detail => 
      detail.winner_team_id === team1Id
    ).length;
    
    const team2Wins = matchData.contest_match_detail.filter(detail => 
      detail.winner_team_id === team2Id
    ).length;
    
    const winnerId = calculateMatchWinner(matchData.contest_match_detail);
    
    return {
      team1Score: team1Wins,
      team2Score: team2Wins,
      winnerId: winnerId,
      isCompleted: winnerId !== null,
      matchDetails: matchData.contest_match_detail
    };
  };
  
  const fetchContestData = async () => {
    try {
      setLoading(true);
      setError('');
      
      // 獲取比賽資料
      const { data: contestData, error: contestError } = await supabase
        .from('contest')
        .select('*')
        .eq('contest_id', contestId)
        .single();
      
      if (contestError) throw contestError;
      setContestData(contestData);
      
      // 獲取參賽隊伍
      const { data: teamsData, error: teamsError } = await supabase
        .from('contest_team')
        .select('*')
        .eq('contest_id', contestId);
      
      if (teamsError) throw teamsError;
      
      // 獲取隊長資訊
      const teamsWithCaptains = [];
      for (const team of teamsData || []) {
        const { data: captainData } = await supabase
          .from('contest_team_member')
          .select('*')
          .eq('contest_team_id', team.contest_team_id)
          .eq('status', 'captain')
          .single();
        
        teamsWithCaptains.push({
          ...team,
          captain_name: captainData?.member_name || '未指定'
        });
      }
      
      setTeams(teamsWithCaptains);
      
      // 生成智能選項
      const smartOpts = getSmartOptions(contestData, teamsWithCaptains.length);
      setSmartOptions(smartOpts);
      
      // 獲取比賽結果並更新賽制結構
      if (contestData.bracket_structure) {
        const fetchedMatchResults = await fetchMatchResults();
        setMatchResults(fetchedMatchResults); // 保存到狀態
        
        const updatedBracket = updateBracketWithResults(contestData.bracket_structure, fetchedMatchResults);
        
        // 如果有變更，保存更新後的賽制結構
        if (JSON.stringify(updatedBracket) !== JSON.stringify(contestData.bracket_structure)) {
          await supabase
            .from('contest')
            .update({ bracket_structure: updatedBracket })
            .eq('contest_id', contestId);
          
          setBracketStructure(updatedBracket);
          setSuccessMessage('賽程已同步最新比賽結果');
          setTimeout(() => setSuccessMessage(''), 3000);
        } else {
          setBracketStructure(contestData.bracket_structure);
        }
      }
      
      // 檢查是否需要顯示配置精靈
      if (!contestData.bracket_structure && contestData.match_mode === 'elimination') {
        setShowConfigWizard(true);
      }
      
    } catch (err: any) {
      console.error('獲取比賽資料失敗:', err);
      setError('獲取比賽資料失敗: ' + err.message);
    } finally {
      setLoading(false);
    }
  };
  
  // 【新增】清除所有隊伍分配的函數
  const clearAllTeamAssignments = (structure: BracketStructure): BracketStructure => {
    const cleanStructure = JSON.parse(JSON.stringify(structure));
    
    // 清除標準淘汰賽模式的分配
    if (cleanStructure.rounds) {
      cleanStructure.rounds.forEach((round: RoundData) => {
        round.matches.forEach((match: MatchData) => {
          match.team1Id = null;
          match.team2Id = null;
          match.winnerId = null;
        });
      });
    }
    
    // 清除雙組模式的分配
    if (cleanStructure.groups) {
      Object.values(cleanStructure.groups).forEach((group: GroupData) => {
        group.bracket.forEach((round: RoundData) => {
          round.matches.forEach((match: MatchData) => {
            match.team1Id = null;
            match.team2Id = null;
            match.winnerId = null;
          });
        });
      });
      
      // 清除決賽階段分配
      if (cleanStructure.final_stage) {
        cleanStructure.final_stage.bracket.forEach((round: RoundData) => {
          round.matches.forEach((match: MatchData) => {
            match.team1Id = null;
            match.team2Id = null;
            match.winnerId = null;
          });
        });
      }
    }
    
    return cleanStructure;
  };
  
  // 【修改】saveConfiguration 函數
  const saveConfiguration = async (mode: string, seedCount: number = 0) => {
    try {
      setSaving(true);
      
      let newBracketStructure: BracketStructure;
      
      switch (mode) {
        case 'elimination':
          newBracketStructure = generateStandardElimination();
          break;
        case 'group_elimination_1':
          newBracketStructure = generateSeedElimination(seedCount);
          break;
        case 'group_elimination_2':
          newBracketStructure = generateDoubleGroupElimination(seedCount);
          break;
        default:
          newBracketStructure = generateStandardElimination();
      }
      
      // 確保新結構是乾淨的（沒有隊伍分配）
      newBracketStructure = clearAllTeamAssignments(newBracketStructure);
      
      // 儲存到資料庫
      const { error } = await supabase
        .from('contest')
        .update({
          match_mode: mode,
          bracket_structure: newBracketStructure
        })
        .eq('contest_id', contestId);
      
      if (error) throw error;
      
      setBracketStructure(newBracketStructure);
      setContestData(prev => ({ ...prev, match_mode: mode, bracket_structure: newBracketStructure }));
      setShowConfigWizard(false);
      setSuccessMessage('賽制配置儲存成功！所有隊伍分配已重置');
      setTimeout(() => setSuccessMessage(''), 3000);
      
    } catch (error: any) {
      setError('儲存配置失敗: ' + error.message);
    } finally {
      setSaving(false);
    }
  };
  
  // 【新增】重新配置按鈕的處理函數
  const handleReconfigureBracket = () => {
    // 顯示確認對話框
    if (confirm('重新配置賽制將清除所有現有的隊伍分配，確定要繼續嗎？')) {
      setShowConfigWizard(true);
      setConfigStep(1); // 重置到第一步
      setSelectedMode('');
      setSelectedSeeds(0);
    }
  };
  
  // 生成標準淘汰賽結構
  const generateStandardElimination = (): BracketStructure => {
    const teamCount = teams.length;
    const rounds: RoundData[] = [];
    
    let currentMatchCount = Math.ceil(teamCount / 2);
    let roundNumber = 1;
    
    while (currentMatchCount > 0) {
      const matches: MatchData[] = [];
      const nextRoundMatchCount = Math.floor(currentMatchCount / 2);
      const isLastRound = nextRoundMatchCount === 0;
      
      for (let m = 1; m <= currentMatchCount; m++) {
        matches.push({
          position: m,
          team1Id: null,
          team2Id: null,
          winnerId: null,
          nextMatchPosition: isLastRound ? null : Math.ceil(m / 2),
          nextMatchTeamSlot: isLastRound ? null : (m % 2 === 1 ? 1 : 2)
        });
      }
      
      rounds.push({ round: roundNumber, matches });
      currentMatchCount = nextRoundMatchCount;
      roundNumber++;
      
      if (roundNumber > 10) break;
    }
    
    return { rounds };
  };
  
  // 生成種子淘汰賽結構
  const generateSeedElimination = (seedCount: number): BracketStructure => {
    const baseStructure = generateStandardElimination();
    
    // 添加種子資訊
    const seedTeamIds = teams.slice(0, seedCount).map(team => team.contest_team_id);
    
    return {
      ...baseStructure,
      seeds: {
        team_ids: seedTeamIds
      }
    };
  };
  
  // 修正後的生成雙組淘汰賽結構
  const generateDoubleGroupElimination = (seedCount: number): BracketStructure => {
    const teamCount = teams.length;
    const groupASize = Math.ceil(teamCount / 2);
    const groupBSize = Math.floor(teamCount / 2);
    
    console.log('開始生成雙組賽制，總隊伍數:', teamCount);
    console.log('A組隊伍數:', groupASize, 'B組隊伍數:', groupBSize);
    
    // 分配隊伍到各組
    let groupATeams = teams.slice(0, groupASize).map(team => team.contest_team_id);
    let groupBTeams = teams.slice(groupASize).map(team => team.contest_team_id);
    
    console.log('初始A組隊伍ID:', groupATeams);
    console.log('初始B組隊伍ID:', groupBTeams);
    
    // 為每組生成淘汰賽樹並分配隊伍
    const generateGroupBracket = (size: number, teamIds: number[]): RoundData[] => {
      const rounds: RoundData[] = [];
      let currentMatchCount = Math.ceil(size / 2);
      let roundNumber = 1;
      let availableTeams = [...teamIds]; // 複製陣列
      
      while (currentMatchCount > 0) {
        const matches: MatchData[] = [];
        const nextRoundMatchCount = Math.floor(currentMatchCount / 2);
        const isLastRound = nextRoundMatchCount === 0;
        
        for (let m = 1; m <= currentMatchCount; m++) {
          let team1Id = null;
          let team2Id = null;
          
          // 第一輪：直接分配隊伍
          if (roundNumber === 1) {
            team1Id = availableTeams.shift() || null;
            team2Id = availableTeams.shift() || null;
          }
          // 後續輪次：等待前一輪的獲勝者
          
          matches.push({
            position: m,
            team1Id,
            team2Id,
            winnerId: null,
            nextMatchPosition: isLastRound ? null : Math.ceil(m / 2),
            nextMatchTeamSlot: isLastRound ? null : (m % 2 === 1 ? 1 : 2)
          });
        }
        
        rounds.push({ round: roundNumber, matches });
        currentMatchCount = nextRoundMatchCount;
        roundNumber++;
        
        if (roundNumber > 8) break;
      }
      
      return rounds;
    };
    
    // 生成跨組決賽階段
    const finalStage: RoundData[] = [
      {
        round: 1,
        matches: [
          {
            position: 1,
            team1Id: null, // A組冠軍
            team2Id: null, // B組冠軍
            winnerId: null,
            nextMatchPosition: null,
            nextMatchTeamSlot: null
          }
        ]
      }
    ];
    
    // 處理種子制分配
    if (seedCount > 0) {
      const seedTeamIds = teams.slice(0, seedCount).map(team => team.contest_team_id);
      const nonSeedTeams = teams.filter(team => 
        !seedTeamIds.includes(team.contest_team_id)
      ).map(team => team.contest_team_id);
      
      // 種子隊伍交替分配到A、B組
      const seedsInA = seedTeamIds.filter((_, index) => index % 2 === 0);
      const seedsInB = seedTeamIds.filter((_, index) => index % 2 === 1);
      
      // 重新分配隊伍確保種子分佈
      groupATeams = [
        ...seedsInA,
        ...nonSeedTeams.slice(0, groupASize - seedsInA.length)
      ];
      
      groupBTeams = [
        ...seedsInB,
        ...nonSeedTeams.slice(groupASize - seedsInA.length)
      ];
      
      console.log('種子制A組隊伍ID:', groupATeams);
      console.log('種子制B組隊伍ID:', groupBTeams);
    }
    
    const structure: BracketStructure = {
      groups: {
        'A': {
          id: 'A',
          name: 'A組',
          teams: groupATeams,
          bracket: generateGroupBracket(groupASize, groupATeams)
        },
        'B': {
          id: 'B',
          name: 'B組',
          teams: groupBTeams,
          bracket: generateGroupBracket(groupBSize, groupBTeams)
        }
      },
      final_stage: {
        bracket: finalStage,
        team_mapping: {
          'team1': { from_group: 'A', rank: 1 },
          'team2': { from_group: 'B', rank: 1 }
        }
      }
    };
    
    // 添加種子資訊
    if (seedCount > 0) {
      const seedTeamIds = teams.slice(0, seedCount).map(team => team.contest_team_id);
      structure.seeds = {
        team_ids: seedTeamIds,
        distribution: {
          'A': groupATeams.filter(teamId => seedTeamIds.includes(teamId)),
          'B': groupBTeams.filter(teamId => seedTeamIds.includes(teamId))
        }
      };
    }
    
    // 調試輸出
    console.log('生成的雙組賽制結構:');
    console.log('A組比賽數:', structure.groups!['A'].bracket.reduce((sum, round) => sum + round.matches.length, 0));
    console.log('B組比賽數:', structure.groups!['B'].bracket.reduce((sum, round) => sum + round.matches.length, 0));
    
    structure.groups!['A'].bracket.forEach((round, roundIndex) => {
      console.log(`A組第${roundIndex + 1}輪:`, round.matches.map(m => `${m.team1Id} vs ${m.team2Id}`));
    });
    
    structure.groups!['B'].bracket.forEach((round, roundIndex) => {
      console.log(`B組第${roundIndex + 1}輪:`, round.matches.map(m => `${m.team1Id} vs ${m.team2Id}`));
    });
    
    return structure;
  };
  
  // 檢查隊伍是否已被分配到其他位置
  const isTeamAlreadyAssigned = (teamId: number): boolean => {
    if (!bracketStructure) return false;
    
    // 檢查標準淘汰賽模式
    if (bracketStructure.rounds) {
      for (const round of bracketStructure.rounds) {
        for (const match of round.matches) {
          if (match.team1Id === teamId || match.team2Id === teamId) {
            return true;
          }
        }
      }
    }
    
    // 檢查雙組模式
    if (bracketStructure.groups) {
      for (const groupId in bracketStructure.groups) {
        const group = bracketStructure.groups[groupId];
        for (const round of group.bracket) {
          for (const match of round.matches) {
            if (match.team1Id === teamId || match.team2Id === teamId) {
              return true;
            }
          }
        }
      }
      
      // 檢查決賽階段
      if (bracketStructure.final_stage) {
        for (const round of bracketStructure.final_stage.bracket) {
          for (const match of round.matches) {
            if (match.team1Id === teamId || match.team2Id === teamId) {
              return true;
            }
          }
        }
      }
    }
    
    return false;
  };
  
  // 移除隊伍從特定位置
  const removeTeamFromPosition = (teamId: number): BracketStructure | null => {
    if (!bracketStructure) return null;
    
    const updatedStructure = JSON.parse(JSON.stringify(bracketStructure));
    
    // 從標準淘汰賽模式移除
    if (updatedStructure.rounds) {
      for (const round of updatedStructure.rounds) {
        for (const match of round.matches) {
          if (match.team1Id === teamId) {
            match.team1Id = null;
          }
          if (match.team2Id === teamId) {
            match.team2Id = null;
          }
        }
      }
    }
    
    // 從雙組模式移除
    if (updatedStructure.groups) {
      for (const groupId in updatedStructure.groups) {
        const group = updatedStructure.groups[groupId];
        for (const round of group.bracket) {
          for (const match of round.matches) {
            if (match.team1Id === teamId) {
              match.team1Id = null;
            }
            if (match.team2Id === teamId) {
              match.team2Id = null;
            }
          }
        }
      }
      
      // 從決賽階段移除
      if (updatedStructure.final_stage) {
        for (const round of updatedStructure.final_stage.bracket) {
          for (const match of round.matches) {
            if (match.team1Id === teamId) {
              match.team1Id = null;
            }
            if (match.team2Id === teamId) {
              match.team2Id = null;
            }
          }
        }
      }
    }
    
    return updatedStructure;
  };
  
  // 修正後的拖曳事件處理函式
  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, team: TeamData) => {
    console.log('Drag start:', team.team_name); // 調試日誌
    setDraggedTeam(team);
    e.dataTransfer.setData('text/plain', team.contest_team_id.toString());
    e.dataTransfer.effectAllowed = 'move';
    
    // 為拖曳元素添加樣式
    e.currentTarget.style.opacity = '0.5';
  };

  const handleDragEnd = (e: React.DragEvent<HTMLDivElement>) => {
    console.log('Drag end'); // 調試日誌
    e.currentTarget.style.opacity = '1';
    setDraggedTeam(null);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    
    // 添加拖曳懸停樣式
    e.currentTarget.style.backgroundColor = '#e3f2fd';
    e.currentTarget.style.border = '2px dashed #2196f3';
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    
    // 移除拖曳懸停樣式
    e.currentTarget.style.backgroundColor = '';
    e.currentTarget.style.border = '';
  };

 const handleDrop = async (
  e: React.DragEvent<HTMLDivElement>, 
  matchPosition: number, 
  teamSlot: 1 | 2, 
  roundIndex: number,
  groupId?: string
) => {
  e.preventDefault();
  e.stopPropagation();
  
  // 移除拖曳懸停樣式
  e.currentTarget.style.backgroundColor = '';
  e.currentTarget.style.border = '';
  
  if (!draggedTeam) return;
  
  const teamId = draggedTeam.contest_team_id;
  
  if (!bracketStructure) {
    setError('賽制結構尚未初始化');
    return;
  }
  
  try {
    // 先移除隊伍在其他位置的分配
    let updatedBracketStructure = removeTeamFromPosition(teamId);
    if (!updatedBracketStructure) {
      updatedBracketStructure = JSON.parse(JSON.stringify(bracketStructure));
    }
    
    // 🎯 新增：同步更新 teams 陣列的函數
    const updateGroupTeams = (structure: BracketStructure, teamId: number, targetGroupId: string) => {
      if (!structure.groups) return structure;
      
      // 從所有組別移除該隊伍
      Object.keys(structure.groups).forEach(gId => {
        const group = structure.groups![gId];
        group.teams = group.teams.filter(id => id !== teamId);
      });
      
      // 添加到目標組別
      if (structure.groups[targetGroupId]) {
        structure.groups[targetGroupId].teams.push(teamId);
      }
      
      return structure;
    };
    
    // 根據比賽模式更新對戰資訊
    if (contestData?.match_mode === 'group_elimination_2' && updatedBracketStructure.groups && groupId) {
      // 雙組模式處理
      const group = updatedBracketStructure.groups[groupId];
      if (group && roundIndex < group.bracket.length) {
        const match = group.bracket[roundIndex].matches.find((m: MatchData) => m.position === matchPosition);
        if (match) {
          if (teamSlot === 1) {
            match.team1Id = teamId;
          } else {
            match.team2Id = teamId;
          }
          
          // 🎯 關鍵修正：同步更新 teams 陣列
          updatedBracketStructure = updateGroupTeams(updatedBracketStructure, teamId, groupId);
          
          console.log('Updated group match and teams:', {
            match,
            groupTeams: updatedBracketStructure.groups[groupId].teams
          });
        }
      }
    } else if (groupId === 'final' && updatedBracketStructure.final_stage) {
      // 決賽階段處理
      const finalMatch = updatedBracketStructure.final_stage.bracket[roundIndex]?.matches.find((m: MatchData) => m.position === matchPosition);
      if (finalMatch) {
        if (teamSlot === 1) {
          finalMatch.team1Id = teamId;
        } else {
          finalMatch.team2Id = teamId;
        }
      }
    } else if (updatedBracketStructure.rounds) {
      // 標準淘汰賽或種子淘汰賽
      if (roundIndex < updatedBracketStructure.rounds.length) {
        const match = updatedBracketStructure.rounds[roundIndex].matches.find((m: MatchData) => m.position === matchPosition);
        if (match) {
          if (teamSlot === 1) {
            match.team1Id = teamId;
          } else {
            match.team2Id = teamId;
          }
        }
      }
    }
    
    // 更新狀態並儲存到資料庫
    setBracketStructure(updatedBracketStructure);
    await saveToDatabase(updatedBracketStructure);
    
  } catch (error: any) {
    console.error('Drop error:', error);
    setError('放置隊伍失敗: ' + error.message);
  }
};
  
  // 儲存到資料庫的輔助函式
  const saveToDatabase = async (structure: BracketStructure) => {
    try {
      setSaving(true);
      const { error } = await supabase
        .from('contest')
        .update({ bracket_structure: structure })
        .eq('contest_id', contestId);
      
      if (error) throw error;
      setSuccessMessage('賽程安排已更新');
      setTimeout(() => setSuccessMessage(''), 2000);
    } catch (error: any) {
      setError('儲存失敗: ' + error.message);
    } finally {
      setSaving(false);
    }
  };

  // 獲取隊伍名稱
  const getTeamName = (teamId: number | null) => {
    if (!teamId) return '';
    const team = teams.find((t: any) => t.contest_team_id === teamId);
    return team ? team.team_name || '未知隊伍' : '未知隊伍';
  };
  
  // 通知隊長排出賽單的函式（保留原有功能）
  const notifyCaptainsForLineup = async () => {
    try {
      setSaving(true);
      setError('');
      
      if (!bracketStructure) {
        setError('請先配置賽制再通知隊長');
        return;
      }
      
      // 檢查現有比賽記錄
      const { data: existingMatches, error: fetchError } = await supabase
        .from('contest_match')
        .select('match_id, team1_id, team2_id, round, match_date')
        .eq('contest_id', contestId);
      
      if (fetchError) {
        setError('無法檢查現有比賽記錄');
        return;
      }
      
      const scheduledMatches: any[] = [];
      let sequence = 1;
      const existingPairs = new Set();
      
      if (existingMatches) {
        existingMatches.forEach((match: any) => {
          if (match.team1_id && match.team2_id) {
            const key = `${match.round}_${match.team1_id}_${match.team2_id}`;
            existingPairs.add(key);
          }
        });
      }
      
      const validTeamIds = new Set(teams.map(team => team.contest_team_id));
      
      // 根據不同模式生成比賽
      if (contestData?.match_mode === 'group_elimination_2' && bracketStructure.groups) {
        // 雙組模式：分別處理各組比賽
        Object.values(bracketStructure.groups).forEach((group: GroupData) => {
          group.bracket.forEach((round: RoundData, roundIndex: number) => {
            round.matches.forEach((match: MatchData) => {
              if (match.team1Id && match.team2Id && 
                  validTeamIds.has(match.team1Id) && validTeamIds.has(match.team2Id)) {
                
                const matchKey = `${roundIndex + 1}_${match.team1Id}_${match.team2Id}`;
                const reverseMatchKey = `${roundIndex + 1}_${match.team2Id}_${match.team1Id}`;
                
                if (!existingPairs.has(matchKey) && !existingPairs.has(reverseMatchKey)) {
                  scheduledMatches.push({
                    contest_id: contestId,
                    team1_id: match.team1Id,
                    team2_id: match.team2Id,
                    match_date: new Date().toISOString().split('T')[0],
                    score: null,
                    round: roundIndex + 1,
                    sequence: sequence++
                  });
                }
              }
            });
          });
        });
        
        // 跨組決賽階段
        if (bracketStructure.final_stage) {
          bracketStructure.final_stage.bracket.forEach((round: RoundData, roundIndex: number) => {
            round.matches.forEach((match: MatchData) => {
              if (match.team1Id && match.team2Id && 
                  validTeamIds.has(match.team1Id) && validTeamIds.has(match.team2Id)) {
                
                const matchKey = `final_${roundIndex + 1}_${match.team1Id}_${match.team2Id}`;
                const reverseMatchKey = `final_${roundIndex + 1}_${match.team2Id}_${match.team1Id}`;
                
                if (!existingPairs.has(matchKey) && !existingPairs.has(reverseMatchKey)) {
                  scheduledMatches.push({
                    contest_id: contestId,
                    team1_id: match.team1Id,
                    team2_id: match.team2Id,
                    match_date: new Date().toISOString().split('T')[0],
                    score: null,
                    round: 100 + roundIndex + 1, // 決賽階段用100+輪次
                    sequence: sequence++
                  });
                }
              }
            });
          });
        }
      } else if (bracketStructure.rounds) {
        // 標準淘汰賽或種子淘汰賽
        bracketStructure.rounds.forEach((round: RoundData, roundIndex: number) => {
          round.matches.forEach((match: MatchData) => {
            if (match.team1Id && match.team2Id && 
                validTeamIds.has(match.team1Id) && validTeamIds.has(match.team2Id)) {
              
              const matchKey = `${roundIndex + 1}_${match.team1Id}_${match.team2Id}`;
              const reverseMatchKey = `${roundIndex + 1}_${match.team2Id}_${match.team1Id}`;
              
              if (!existingPairs.has(matchKey) && !existingPairs.has(reverseMatchKey)) {
                scheduledMatches.push({
                  contest_id: contestId,
                  team1_id: match.team1Id,
                  team2_id: match.team2Id,
                  match_date: new Date().toISOString().split('T')[0],
                  score: null,
                  round: roundIndex + 1,
                  sequence: sequence++
                });
              }
            }
          });
        });
      }
      
      if (scheduledMatches.length === 0) {
        setSuccessMessage('所有比賽都已建立，無需新增');
        return;
      }
      
      // 批次插入比賽記錄
      const { data: matchesData, error: matchesError } = await supabase
        .from('contest_match')
        .insert(scheduledMatches)
        .select();
      
      if (matchesError) throw matchesError;
      
      if (!matchesData || matchesData.length === 0) {
        setError('比賽記錄建立失敗');
        return;
      }
      
      // 獲取比賽設定
      const totalPoints = contestData.total_points || 3;
      let pointsConfig: any[] = [];
      
      try {
        if (contestData.points_config) {
          if (typeof contestData.points_config === 'string') {
            pointsConfig = JSON.parse(contestData.points_config);
          } else {
            pointsConfig = contestData.points_config;
          }
          
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
        pointsConfig = [
          { type: '雙打', points: 1 },
          { type: '雙打', points: 1 },
          { type: '單打', points: 1 }
        ];
      }
      
      // 為每場比賽建立詳細記錄和隊長通知
      for (const matchRecord of matchesData) {
        // 建立比賽詳細記錄
        for (let i = 0; i < totalPoints; i++) {
          let matchType = '單打';
          
          if (pointsConfig && pointsConfig.length > 0) {
            const configIndex = i < pointsConfig.length ? i : pointsConfig.length - 1;
            let configType = pointsConfig[configIndex].type || '單打';
            
            if (configType.toLowerCase() === 'singles') {
              configType = '單打';
            } else if (configType.toLowerCase() === 'doubles') {
              configType = '雙打';
            }
            
            matchType = (configType === '單打' || configType === '雙打') ? configType : '單打';
          } else {
            matchType = i < 2 ? '雙打' : '單打';
          }
          
          const matchDetail = {
            match_id: matchRecord.match_id,
            contest_id: contestId,
            match_type: matchType,
            sequence: i + 1,
            team1_member_ids: [],
            team2_member_ids: [],
            winner_team_id: null,
            score: null,
            bracket_round: matchRecord.round
          };
          
          await supabase.from('contest_match_detail').insert(matchDetail);
        }
        
        // 通知隊長1
        const { data: team1Captains } = await supabase
          .from('contest_team_member')
          .select('member_id')
          .eq('contest_team_id', matchRecord.team1_id)
          .eq('status', 'captain');
        
        if (team1Captains && team1Captains.length > 0) {
          await supabase.from('captain_pending_lineups').insert({
            match_id: matchRecord.match_id,
            member_id: team1Captains[0].member_id,
            contest_team_id: matchRecord.team1_id,
            pending_team_type: 'team1',
            created_at: new Date().toISOString()
          });
        }
        
        // 通知隊長2
        const { data: team2Captains } = await supabase
          .from('contest_team_member')
          .select('member_id')
          .eq('contest_team_id', matchRecord.team2_id)
          .eq('status', 'captain');
        
        if (team2Captains && team2Captains.length > 0) {
          await supabase.from('captain_pending_lineups').insert({
            match_id: matchRecord.match_id,
            member_id: team2Captains[0].member_id,
            contest_team_id: matchRecord.team2_id,
            pending_team_type: 'team2',
            created_at: new Date().toISOString()
          });
        }
      }
      
      // 更新比賽狀態
      await supabase
        .from('contest')
        .update({ contest_status: 'lineup_arrangement' })
        .eq('contest_id', contestId);
      
      // 觸發通知更新事件
      try {
        const updateEvent = new Event('updateNotificationCount');
        window.dispatchEvent(updateEvent);
      } catch (eventError) {
        console.error('觸發通知更新事件失敗:', eventError);
      }
      
      setSuccessMessage('已成功通知隊長排出選手出賽單');
      setTimeout(() => setSuccessMessage(''), 3000);
      
    } catch (error: any) {
      console.error('通知隊長失敗:', error);
      setError('通知隊長失敗: ' + error.message);
    } finally {
      setSaving(false);
    }
  };
  
  // 渲染配置精靈
  const renderConfigWizard = () => {
    if (!smartOptions) return null;
    
    const handleModeSelect = (mode: TournamentMode) => {
      setSelectedMode(mode.value);
      if (mode.value === 'elimination') {
        saveConfiguration(mode.value);
      } else {
        setConfigStep(2);
      }
    };
    
    const handleSeedSelect = (seedCount: number) => {
      setSelectedSeeds(seedCount);
      setConfigStep(3);
    };
    
    const handleFinalConfirm = () => {
      saveConfiguration(selectedMode, selectedSeeds);
    };
    
    return (
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.5)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 1000
      }}>
        <div style={{
          backgroundColor: 'white',
          borderRadius: '8px',
          padding: '24px',
          maxWidth: '600px',
          width: '90%',
          maxHeight: '80vh',
          overflow: 'auto'
        }}>
          <h2 style={{ marginBottom: '20px', color: '#333' }}>🎯 智慧賽制配置精靈</h2>
          
          {/* 隊伍資訊顯示 */}
          <div style={{
            display: 'flex',
            gap: '20px',
            marginBottom: '20px',
            padding: '12px',
            backgroundColor: '#f9f9f9',
            borderRadius: '6px'
          }}>
            <div>
              <span style={{ fontWeight: 'bold' }}>預期隊伍:</span>
              <span style={{ marginLeft: '8px', color: '#2196f3' }}>{smartOptions.totalTeams}隊</span>
            </div>
            <div>
              <span style={{ fontWeight: 'bold' }}>實際報名:</span>
              <span style={{ marginLeft: '8px', color: '#4caf50' }}>{smartOptions.actualTeams}隊</span>
            </div>
            <div>
              <span style={{ fontWeight: 'bold' }}>每隊人數:</span>
              <span style={{ marginLeft: '8px' }}>{smartOptions.playersPerTeam}人</span>
            </div>
          </div>
          
          {configStep === 1 && (
            <div>
              <h3 style={{ marginBottom: '16px' }}>選擇比賽模式</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {smartOptions.recommendedModes.map(mode => (
                  <div 
                    key={mode.value}
                    style={{
                      border: `2px solid ${mode.recommended ? '#4caf50' : '#ddd'}`,
                      borderRadius: '8px',
                      padding: '16px',
                      cursor: 'pointer',
                      backgroundColor: mode.recommended ? '#f1f8e9' : '#fff',
                      transition: 'all 0.2s ease'
                    }}
                    onClick={() => handleModeSelect(mode)}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = 'translateY(-2px)';
                      e.currentTarget.style.boxShadow = '0 4px 8px rgba(0,0,0,0.1)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
                      <h4 style={{ margin: 0, marginRight: '12px' }}>{mode.label}</h4>
                      {mode.recommended && (
                        <span style={{
                          backgroundColor: '#4caf50',
                          color: 'white',
                          padding: '2px 8px',
                          borderRadius: '12px',
                          fontSize: '12px'
                        }}>推薦</span>
                      )}
                    </div>
                    
                    <div style={{ color: '#666', marginBottom: '8px' }}>{mode.description}</div>
                    
                    <div style={{ fontSize: '14px', color: '#888' }}>
                      {mode.rounds && <span>預計 {mode.rounds} 輪 </span>}
                      {mode.seedCount && <span>建議 {mode.seedCount} 個種子 </span>}
                      {mode.groupSizes && <span>各組規模: {mode.groupSizes.join(', ')}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {configStep === 2 && (
            <div>
              <h3 style={{ marginBottom: '16px' }}>設定種子隊伍</h3>
              <p style={{ marginBottom: '16px', color: '#666' }}>
                選擇的模式: {smartOptions.recommendedModes.find(m => m.value === selectedMode)?.label}
              </p>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div 
                  style={{
                    border: '2px solid #ddd',
                    borderRadius: '8px',
                    padding: '16px',
                    cursor: 'pointer',
                    backgroundColor: '#fff'
                  }}
                  onClick={() => handleSeedSelect(0)}
                >
                  <h4 style={{ margin: '0 0 8px 0' }}>不使用種子制</h4>
                  <p style={{ margin: 0, color: '#666' }}>所有隊伍隨機分配</p>
                </div>
                
                {smartOptions.seedOptions.map(option => (
                  <div 
                    key={option.count}
                    style={{
                      border: `2px solid ${option.optimal ? '#ff9800' : '#ddd'}`,
                      borderRadius: '8px',
                      padding: '16px',
                      cursor: 'pointer',
                      backgroundColor: option.optimal ? '#fff3e0' : '#fff'
                    }}
                    onClick={() => handleSeedSelect(option.count)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
                      <h4 style={{ margin: 0, marginRight: '12px' }}>{option.label}</h4>
                      {option.optimal && (
                        <span style={{
                          backgroundColor: '#ff9800',
                          color: 'white',
                          padding: '2px 8px',
                          borderRadius: '12px',
                          fontSize: '12px'
                        }}>最佳</span>
                      )}
                    </div>
                    <p style={{ margin: 0, color: '#666' }}>前{option.count}名隊伍獲得種子保護</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {configStep === 3 && (
            <div>
              <h3 style={{ marginBottom: '16px' }}>配置預覽</h3>
              <div style={{
                backgroundColor: '#f9f9f9',
                padding: '16px',
                borderRadius: '8px',
                marginBottom: '20px'
              }}>
                <div style={{ marginBottom: '8px' }}>
                  <span style={{ fontWeight: 'bold' }}>比賽模式:</span>
                  <span style={{ marginLeft: '8px' }}>
                    {smartOptions.recommendedModes.find(m => m.value === selectedMode)?.label}
                  </span>
                </div>
                <div style={{ marginBottom: '8px' }}>
                  <span style={{ fontWeight: 'bold' }}>參賽隊伍:</span>
                  <span style={{ marginLeft: '8px' }}>{smartOptions.actualTeams}隊</span>
                </div>
                <div>
                  <span style={{ fontWeight: 'bold' }}>種子隊伍:</span>
                  <span style={{ marginLeft: '8px' }}>
                    {selectedSeeds > 0 ? `${selectedSeeds}個` : '不使用'}
                  </span>
                </div>
              </div>
              
              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                <button 
                  className="back-btn"
                  onClick={() => setConfigStep(configStep - 1)}
                >
                  上一步
                </button>
                <button 
                  className="save-btn"
                  onClick={handleFinalConfirm}
                  disabled={saving}
                >
                  {saving ? '配置中...' : '確認配置'}
                </button>
              </div>
            </div>
          )}
          
          <div style={{ marginTop: '20px', textAlign: 'center' }}>
            <button 
              className="reset-btn"
              onClick={() => setShowConfigWizard(false)}
            >
              跳過配置
            </button>
          </div>
        </div>
      </div>
    );
  };
  
  // 渲染標準淘汰賽UI
  const renderStandardElimination = () => {
    if (!bracketStructure?.rounds) return null;
    
    return (
      <div className="bracket-wrapper">
        <div className="tournament-bracket">
          {bracketStructure.rounds.map((round, roundIndex) => (
            <div key={`round-${roundIndex}`} className="round">
              <div className="round-header">第 {roundIndex + 1} 輪</div>
              <div className="matches">
                {round.matches.map((match, matchIndex) => {
                  const matchResult = getMatchResult(match.team1Id, match.team2Id, matchResults);
                  
                  return (
                    <div key={`match-${roundIndex}-${matchIndex}`} className="match">
                      <div 
                        className={`match-slot ${!match.team1Id ? 'empty' : ''} ${matchResult?.winnerId === match.team1Id ? 'winner' : matchResult?.isCompleted ? 'loser' : ''}`}
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={(e) => handleDrop(e, match.position, 1, roundIndex)}
                        style={{
                          minHeight: '60px',
                          border: `2px solid ${matchResult?.winnerId === match.team1Id ? '#4caf50' : matchResult?.isCompleted ? '#f44336' : '#ddd'}`,
                          borderRadius: '4px',
                          padding: '8px',
                          margin: '4px',
                          backgroundColor: matchResult?.winnerId === match.team1Id ? '#e8f5e8' : 
                                         matchResult?.isCompleted ? '#ffeaea' : 
                                         match.team1Id ? '#f8f9fa' : '#fff',
                          cursor: 'pointer',
                          transition: 'all 0.2s ease',
                          position: 'relative'
                        }}
                      >
                        <div className="team-info">
                          <div className="team-name" style={{ 
                            fontWeight: 'bold',
                            color: matchResult?.winnerId === match.team1Id ? '#2e7d32' : '#333'
                          }}>
                            {match.team1Id ? getTeamName(match.team1Id) : '拖放隊伍到此'}
                          </div>
                          {match.team1Id && (
                            <div className="team-captain" style={{ fontSize: '0.8em', color: '#666' }}>
                              {teams.find((t: TeamData) => t.contest_team_id === match.team1Id)?.captain_name || '未指定'}
                            </div>
                          )}
                          {matchResult && (
                            <div style={{ 
                              position: 'absolute', 
                              top: '4px', 
                              right: '4px',
                              backgroundColor: matchResult.winnerId === match.team1Id ? '#4caf50' : '#757575',
                              color: 'white',
                              borderRadius: '50%',
                              width: '24px',
                              height: '24px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: '12px',
                              fontWeight: 'bold'
                            }}>
                              {matchResult.team1Score}
                            </div>
                          )}
                        </div>
                      </div>
                      
                      <div className="vs" style={{ 
                        padding: '8px', 
                        fontWeight: 'bold',
                        color: matchResult?.isCompleted ? '#4caf50' : '#666'
                      }}>
                        {matchResult?.isCompleted ? '✓' : 'VS'}
                      </div>
                      
                      <div 
                        className={`match-slot ${!match.team2Id ? 'empty' : ''} ${matchResult?.winnerId === match.team2Id ? 'winner' : matchResult?.isCompleted ? 'loser' : ''}`}
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={(e) => handleDrop(e, match.position, 2, roundIndex)}
                        style={{
                          minHeight: '60px',
                          border: `2px solid ${matchResult?.winnerId === match.team2Id ? '#4caf50' : matchResult?.isCompleted ? '#f44336' : '#ddd'}`,
                          borderRadius: '4px',
                          padding: '8px',
                          margin: '4px',
                          backgroundColor: matchResult?.winnerId === match.team2Id ? '#e8f5e8' : 
                                         matchResult?.isCompleted ? '#ffeaea' : 
                                         match.team2Id ? '#f8f9fa' : '#fff',
                          cursor: 'pointer',
                          transition: 'all 0.2s ease',
                          position: 'relative'
                        }}
                      >
                        <div className="team-info">
                          <div className="team-name" style={{ 
                            fontWeight: 'bold',
                            color: matchResult?.winnerId === match.team2Id ? '#2e7d32' : '#333'
                          }}>
                            {match.team2Id ? getTeamName(match.team2Id) : '拖放隊伍到此'}
                          </div>
                          {match.team2Id && (
                            <div className="team-captain" style={{ fontSize: '0.8em', color: '#666' }}>
                              {teams.find((t: TeamData) => t.contest_team_id === match.team2Id)?.captain_name || '未指定'}
                            </div>
                          )}
                          {matchResult && (
                            <div style={{ 
                              position: 'absolute', 
                              top: '4px', 
                              right: '4px',
                              backgroundColor: matchResult.winnerId === match.team2Id ? '#4caf50' : '#757575',
                              color: 'white',
                              borderRadius: '50%',
                              width: '24px',
                              height: '24px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: '12px',
                              fontWeight: 'bold'
                            }}>
                              {matchResult.team2Score}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };
  
  // 渲染雙組淘汰賽UI
  const renderDoubleGroupElimination = () => {
    if (!bracketStructure?.groups) return null;
    
    return (
      <div className="bracket-wrapper">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
          {/* A組和B組 */}
          <div style={{ display: 'flex', gap: '40px' }}>
            {Object.values(bracketStructure.groups).map((group: GroupData) => (
              <div key={group.id} style={{ flex: 1 }}>
                <h3 style={{ 
                  textAlign: 'center', 
                  marginBottom: '20px',
                  padding: '10px',
                  backgroundColor: '#f0f0f0',
                  borderRadius: '8px'
                }}>
                  {group.name}
                </h3>
                <div className="tournament-bracket">
                  {group.bracket.map((round, roundIndex) => (
                    <div key={`${group.id}-round-${roundIndex}`} className="round">
                      <div className="round-header">第 {roundIndex + 1} 輪</div>
                      <div className="matches">
                        {round.matches.map((match, matchIndex) => {
                          const matchResult = getMatchResult(match.team1Id, match.team2Id, matchResults);
                          
                          return (
                            <div key={`${group.id}-match-${roundIndex}-${matchIndex}`} className="match">
                              <div 
                                className="match-slot"
                                onDragOver={handleDragOver}
                                onDragLeave={handleDragLeave}
                                onDrop={(e) => handleDrop(e, match.position, 1, roundIndex, group.id)}
                                style={{
                                  minHeight: '60px',
                                  border: `2px solid ${matchResult?.winnerId === match.team1Id ? '#4caf50' : matchResult?.isCompleted ? '#f44336' : '#ddd'}`,
                                  borderRadius: '4px',
                                  padding: '8px',
                                  margin: '4px',
                                  backgroundColor: matchResult?.winnerId === match.team1Id ? '#e8f5e8' : 
                                                 matchResult?.isCompleted ? '#ffeaea' : 
                                                 match.team1Id ? '#f8f9fa' : '#fff',
                                  cursor: 'pointer',
                                  transition: 'all 0.2s ease',
                                  position: 'relative'
                                }}
                              >
                                <div className="team-info">
                                  <div className="team-name" style={{ 
                                    fontWeight: 'bold',
                                    color: matchResult?.winnerId === match.team1Id ? '#2e7d32' : '#333'
                                  }}>
                                    {match.team1Id ? getTeamName(match.team1Id) : '拖放隊伍到此'}
                                  </div>
                                  {match.team1Id && (
                                    <div className="team-captain" style={{ fontSize: '0.8em', color: '#666' }}>
                                      {teams.find(t => t.contest_team_id === match.team1Id)?.captain_name || '未指定'}
                                    </div>
                                  )}
                                  {matchResult && (
                                    <div style={{ 
                                      position: 'absolute', 
                                      top: '4px', 
                                      right: '4px',
                                      backgroundColor: matchResult.winnerId === match.team1Id ? '#4caf50' : '#757575',
                                      color: 'white',
                                      borderRadius: '50%',
                                      width: '24px',
                                      height: '24px',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      fontSize: '12px',
                                      fontWeight: 'bold'
                                    }}>
                                      {matchResult.team1Score}
                                    </div>
                                  )}
                                </div>
                              </div>
                              
                              <div className="vs" style={{ 
                                padding: '8px', 
                                fontWeight: 'bold',
                                color: matchResult?.isCompleted ? '#4caf50' : '#666'
                              }}>
                                {matchResult?.isCompleted ? '✓' : 'VS'}
                              </div>
                              
                              <div 
                                className="match-slot"
                                onDragOver={handleDragOver}
                                onDragLeave={handleDragLeave}
                                onDrop={(e) => handleDrop(e, match.position, 2, roundIndex, group.id)}
                                style={{
                                  minHeight: '60px',
                                  border: `2px solid ${matchResult?.winnerId === match.team2Id ? '#4caf50' : matchResult?.isCompleted ? '#f44336' : '#ddd'}`,
                                  borderRadius: '4px',
                                  padding: '8px',
                                  margin: '4px',
                                  backgroundColor: matchResult?.winnerId === match.team2Id ? '#e8f5e8' : 
                                                 matchResult?.isCompleted ? '#ffeaea' : 
                                                 match.team2Id ? '#f8f9fa' : '#fff',
                                  cursor: 'pointer',
                                  transition: 'all 0.2s ease',
                                  position: 'relative'
                                }}
                              >
                                <div className="team-info">
                                  <div className="team-name" style={{ 
                                    fontWeight: 'bold',
                                    color: matchResult?.winnerId === match.team2Id ? '#2e7d32' : '#333'
                                  }}>
                                    {match.team2Id ? getTeamName(match.team2Id) : '拖放隊伍到此'}
                                  </div>
                                  {match.team2Id && (
                                    <div className="team-captain" style={{ fontSize: '0.8em', color: '#666' }}>
                                      {teams.find(t => t.contest_team_id === match.team2Id)?.captain_name || '未指定'}
                                    </div>
                                  )}
                                  {matchResult && (
                                    <div style={{ 
                                      position: 'absolute', 
                                      top: '4px', 
                                      right: '4px',
                                      backgroundColor: matchResult.winnerId === match.team2Id ? '#4caf50' : '#757575',
                                      color: 'white',
                                      borderRadius: '50%',
                                      width: '24px',
                                      height: '24px',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      fontSize: '12px',
                                      fontWeight: 'bold'
                                    }}>
                                      {matchResult.team2Score}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          
          {/* 跨組決賽階段 */}
          {bracketStructure.final_stage && (
            <div style={{ 
              borderTop: '2px solid #ddd', 
              paddingTop: '30px',
              textAlign: 'center'
            }}>
              <h3 style={{ 
                marginBottom: '20px',
                padding: '10px',
                backgroundColor: '#fff3cd',
                borderRadius: '8px',
                display: 'inline-block',
                minWidth: '200px'
              }}>
                🏆 決賽階段
              </h3>
              <div className="tournament-bracket" style={{ justifyContent: 'center' }}>
                {bracketStructure.final_stage.bracket.map((round, roundIndex) => (
                  <div key={`final-round-${roundIndex}`} className="round">
                    <div className="round-header">總決賽</div>
                    <div className="matches">
                      {round.matches.map((match, matchIndex) => {
                        const matchResult = getMatchResult(match.team1Id, match.team2Id, matchResults);
                        
                        return (
                          <div key={`final-match-${roundIndex}-${matchIndex}`} className="match">
                            <div 
                              className="match-slot"
                              onDragOver={handleDragOver}
                              onDragLeave={handleDragLeave}
                              onDrop={(e) => handleDrop(e, match.position, 1, roundIndex, 'final')}
                              style={{
                                minHeight: '60px',
                                border: `2px solid ${matchResult?.winnerId === match.team1Id ? '#4caf50' : matchResult?.isCompleted ? '#f44336' : '#ffc107'}`,
                                borderRadius: '4px',
                                padding: '8px',
                                margin: '4px',
                                backgroundColor: matchResult?.winnerId === match.team1Id ? '#e8f5e8' : 
                                               matchResult?.isCompleted ? '#ffeaea' : 
                                               match.team1Id ? '#fff3cd' : '#fffef7',
                                cursor: 'pointer',
                                transition: 'all 0.2s ease',
                                position: 'relative'
                              }}
                            >
                              <div className="team-info">
                                <div className="team-name" style={{ 
                                  fontWeight: 'bold',
                                  color: matchResult?.winnerId === match.team1Id ? '#2e7d32' : '#333'
                                }}>
                                  {match.team1Id ? getTeamName(match.team1Id) : 'A組冠軍'}
                                </div>
                                {match.team1Id && (
                                  <div className="team-captain" style={{ fontSize: '0.8em', color: '#666' }}>
                                    {teams.find(t => t.contest_team_id === match.team1Id)?.captain_name || '未指定'}
                                  </div>
                                )}
                                {matchResult && (
                                  <div style={{ 
                                    position: 'absolute', 
                                    top: '4px', 
                                    right: '4px',
                                    backgroundColor: matchResult.winnerId === match.team1Id ? '#4caf50' : '#757575',
                                    color: 'white',
                                    borderRadius: '50%',
                                    width: '24px',
                                    height: '24px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: '12px',
                                    fontWeight: 'bold'
                                  }}>
                                    {matchResult.team1Score}
                                  </div>
                                )}
                              </div>
                            </div>
                            
                            <div className="vs" style={{ 
                              fontWeight: 'bold', 
                              color: matchResult?.isCompleted ? '#4caf50' : '#ff6b00', 
                              padding: '8px' 
                            }}>
                              {matchResult?.isCompleted ? '🏆' : 'VS'}
                            </div>
                            
                            <div 
                              className="match-slot"
                              onDragOver={handleDragOver}
                              onDragLeave={handleDragLeave}
                              onDrop={(e) => handleDrop(e, match.position, 2, roundIndex, 'final')}
                              style={{
                                minHeight: '60px',
                                border: `2px solid ${matchResult?.winnerId === match.team2Id ? '#4caf50' : matchResult?.isCompleted ? '#f44336' : '#ffc107'}`,
                                borderRadius: '4px',
                                padding: '8px',
                                margin: '4px',
                                backgroundColor: matchResult?.winnerId === match.team2Id ? '#e8f5e8' : 
                                               matchResult?.isCompleted ? '#ffeaea' : 
                                               match.team2Id ? '#fff3cd' : '#fffef7',
                                cursor: 'pointer',
                                transition: 'all 0.2s ease',
                                position: 'relative'
                              }}
                            >
                              <div className="team-info">
                                <div className="team-name" style={{ 
                                  fontWeight: 'bold',
                                  color: matchResult?.winnerId === match.team2Id ? '#2e7d32' : '#333'
                                }}>
                                  {match.team2Id ? getTeamName(match.team2Id) : 'B組冠軍'}
                                </div>
                                {match.team2Id && (
                                  <div className="team-captain" style={{ fontSize: '0.8em', color: '#666' }}>
                                    {teams.find(t => t.contest_team_id === match.team2Id)?.captain_name || '未指定'}
                                  </div>
                                )}
                                {matchResult && (
                                  <div style={{ 
                                    position: 'absolute', 
                                    top: '4px', 
                                    right: '4px',
                                    backgroundColor: matchResult.winnerId === match.team2Id ? '#4caf50' : '#757575',
                                    color: 'white',
                                    borderRadius: '50%',
                                    width: '24px',
                                    height: '24px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: '12px',
                                    fontWeight: 'bold'
                                  }}>
                                    {matchResult.team2Score}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };
  
  // 渲染頂部控制按鈕
  const renderTopControls = () => {
    return (
      <div className="top-controls" style={{
        display: 'flex',
        gap: '16px',
        marginBottom: '20px',
        padding: '16px',
        backgroundColor: '#f8f9fa',
        borderRadius: '8px',
        alignItems: 'center',
        flexWrap: 'wrap'
      }}>
        {/* 比賽資訊 */}
        <div style={{ 
          backgroundColor: '#fff', 
          padding: '12px 16px', 
          borderRadius: '6px',
          border: '1px solid #e0e0e0',
          flex: '1',
          minWidth: '300px'
        }}>
          <div style={{ fontWeight: 'bold', marginBottom: '4px', fontSize: '16px' }}>
            {contestData?.contest_name}
          </div>
          <div style={{ fontSize: '14px', color: '#666' }}>
            {contestData?.match_mode === 'elimination' && '標準淘汰賽'}
            {contestData?.match_mode === 'group_elimination_1' && '種子淘汰賽'}
            {contestData?.match_mode === 'group_elimination_2' && '雙組淘汰賽'}
            {' • '}
            <span>總隊伍: {teams.length}</span>
            {contestData?.expected_teams && (
              <span> / 預期: {contestData.expected_teams}</span>
            )}
          </div>
        </div>
        
        {/* 控制按鈕組 */}
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <button 
            className="sync-btn" 
            onClick={syncMatchResults}
            disabled={saving || !bracketStructure}
            style={{
              padding: '12px 20px',
              backgroundColor: '#28a745',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              fontWeight: 'bold',
              cursor: (saving || !bracketStructure) ? 'not-allowed' : 'pointer',
              opacity: (saving || !bracketStructure) ? 0.6 : 1,
              transition: 'all 0.2s ease',
              whiteSpace: 'nowrap'
            }}
            onMouseEnter={(e) => {
              if (!saving && bracketStructure) e.currentTarget.style.backgroundColor = '#218838';
            }}
            onMouseLeave={(e) => {
              if (!saving && bracketStructure) e.currentTarget.style.backgroundColor = '#28a745';
            }}
          >
            {saving ? '同步中...' : '同步比賽結果'}
          </button>

          <button 
            className="reset-btn" 
            onClick={handleReconfigureBracket}
            disabled={saving}
            style={{
              padding: '12px 20px',
              backgroundColor: '#dc3545',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              fontWeight: 'bold',
              cursor: saving ? 'not-allowed' : 'pointer',
              opacity: saving ? 0.6 : 1,
              transition: 'all 0.2s ease',
              whiteSpace: 'nowrap'
            }}
            onMouseEnter={(e) => {
              if (!saving) e.currentTarget.style.backgroundColor = '#c82333';
            }}
            onMouseLeave={(e) => {
              if (!saving) e.currentTarget.style.backgroundColor = '#dc3545';
            }}
          >
            重新配置賽制
          </button>
          
          <button 
            className="notify-btn" 
            onClick={notifyCaptainsForLineup}
            disabled={saving || !bracketStructure}
            style={{
              padding: '12px 20px',
              backgroundColor: '#fd7e14',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              fontWeight: 'bold',
              cursor: (saving || !bracketStructure) ? 'not-allowed' : 'pointer',
              opacity: (saving || !bracketStructure) ? 0.6 : 1,
              transition: 'all 0.2s ease',
              whiteSpace: 'nowrap'
            }}
            onMouseEnter={(e) => {
              if (!saving && bracketStructure) e.currentTarget.style.backgroundColor = '#e8680e';
            }}
            onMouseLeave={(e) => {
              if (!saving && bracketStructure) e.currentTarget.style.backgroundColor = '#fd7e14';
            }}
          >
            {saving ? '通知中...' : '通知隊長排出賽單'}
          </button>
          
          <button 
            className="back-btn" 
            onClick={() => navigate(`/contest/${contestId}`)}
            style={{
              padding: '12px 20px',
              backgroundColor: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              fontWeight: 'bold',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              whiteSpace: 'nowrap'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#0056b3';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '#007bff';
            }}
          >
            返回戰況室
          </button>
        </div>
      </div>
    );
  };
  
  // 渲染左側隊伍面板 
  const renderTeamsPanel = () => {
    return (
      <div className="teams-panel" style={{
        width: '320px',
        backgroundColor: '#fff',
        borderRadius: '8px',
        padding: '20px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        height: 'fit-content',
        maxHeight: 'calc(100vh - 200px)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column'
      }}>
        <h2 style={{ 
          margin: '0 0 16px 0', 
          fontSize: '18px',
          color: '#1e40af',
          borderBottom: '2px solid #3b82f6',
          paddingBottom: '8px'
        }}>
          參賽隊伍
        </h2>
        
        {/* 隊伍統計 */}
        <div style={{ 
          marginBottom: '16px',
          padding: '12px',
          backgroundColor: '#f0f9ff',
          borderRadius: '6px',
          border: '1px solid #dbeafe'
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#666', fontSize: '14px' }}>總隊伍數:</span>
              <span style={{ fontWeight: 'bold' }}>{teams.length}</span>
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#666', fontSize: '14px' }}>已安排:</span>
              <span style={{ fontWeight: 'bold', color: '#4caf50' }}>
                {teams.filter(team => isTeamAlreadyAssigned(team.contest_team_id)).length}
              </span>
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#666', fontSize: '14px' }}>未安排:</span>
              <span style={{ fontWeight: 'bold', color: '#ff9800' }}>
                {teams.filter(team => !isTeamAlreadyAssigned(team.contest_team_id)).length}
              </span>
            </div>
            
            {bracketStructure?.seeds && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#666', fontSize: '14px' }}>種子隊伍:</span>
                <span style={{ fontWeight: 'bold', color: '#ff9800' }}>
                  {bracketStructure.seeds.team_ids.length}
                </span>
              </div>
            )}
          </div>
        </div>
        
        {/* 操作提示 */}
        <div style={{ 
          marginBottom: '16px', 
          fontSize: '12px', 
          color: '#666',
          backgroundColor: '#f9f9f9',
          padding: '8px',
          borderRadius: '4px',
          border: '1px solid #e0e0e0'
        }}>
          💡 拖拽隊伍到對戰位置進行安排
        </div>
        
        {/* 隊伍列表 */}
        <div style={{ 
          flex: 1, 
          overflowY: 'auto',
          marginRight: '-8px',
          paddingRight: '8px'
        }}>
          <div className="teams-list">
            {teams.map((team: TeamData) => {
              const isAssigned = isTeamAlreadyAssigned(team.contest_team_id);
              const isSeed = bracketStructure?.seeds?.team_ids.includes(team.contest_team_id);
              
              return (
                <div 
                  key={team.contest_team_id}
                  className="team-card"
                  draggable={true}
                  onDragStart={(e) => handleDragStart(e, team)}
                  onDragEnd={handleDragEnd}
                  style={{
                    backgroundColor: isSeed ? '#fff3e0' : '#fff',
                    border: `2px solid ${isAssigned ? '#ddd' : '#e0e0e0'}`,
                    borderRadius: '8px',
                    padding: '12px',
                    margin: '8px 0',
                    cursor: 'grab',
                    opacity: isAssigned ? 0.6 : 1,
                    transition: 'all 0.2s ease',
                    userSelect: 'none',
                    position: 'relative'
                  }}
                  onMouseEnter={(e) => {
                    if (!isAssigned) {
                      e.currentTarget.style.transform = 'translateY(-2px)';
                      e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
                      e.currentTarget.style.borderColor = '#3b82f6';
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = 'none';
                    e.currentTarget.style.borderColor = isAssigned ? '#ddd' : '#e0e0e0';
                  }}
                >
                  <div className="team-name" style={{ 
                    fontWeight: 'bold', 
                    marginBottom: '6px',
                    color: isAssigned ? '#999' : '#333',
                    fontSize: '14px'
                  }}>
                    {team.team_name}
                  </div>
                  
                  <div className="team-captain" style={{ 
                    fontSize: '12px', 
                    color: isAssigned ? '#999' : '#666',
                    marginBottom: '8px'
                  }}>
                    隊長: {team.captain_name || '未指定'}
                  </div>
                  
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                    {isSeed && (
                      <span style={{
                        backgroundColor: '#ff9800',
                        color: 'white',
                        padding: '2px 6px',
                        borderRadius: '12px',
                        fontSize: '10px',
                        fontWeight: 'bold'
                      }}>
                        種子
                      </span>
                    )}
                    
                    {isAssigned ? (
                      <span style={{
                        backgroundColor: '#4caf50',
                        color: 'white',
                        padding: '2px 6px',
                        borderRadius: '12px',
                        fontSize: '10px',
                        fontWeight: 'bold'
                      }}>
                        已安排
                      </span>
                    ) : (
                      <span style={{
                        backgroundColor: '#ff9800',
                        color: 'white',
                        padding: '2px 6px',
                        borderRadius: '12px',
                        fontSize: '10px',
                        fontWeight: 'bold'
                      }}>
                        待安排
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };
  
  // 渲染主要内容
  const renderMainContent = () => {
    if (showConfigWizard) {
      return renderConfigWizard();
    }
    
    if (!bracketStructure) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '400px',
          backgroundColor: '#f9f9f9',
          borderRadius: '8px',
          margin: '20px'
        }}>
          <h3 style={{ color: '#666', marginBottom: '16px' }}>尚未配置赛制</h3>
          <p style={{ color: '#888', marginBottom: '20px' }}>请使用配置精灵设置比赛模式</p>
          <button 
            className="save-btn"
            onClick={() => setShowConfigWizard(true)}
          >
            开始配置
          </button>
        </div>
      );
    }
    
    switch (contestData?.match_mode) {
      case 'elimination':
      case 'group_elimination_1':
        return renderStandardElimination();
      case 'group_elimination_2':
        return renderDoubleGroupElimination();
      default:
        return renderStandardElimination();
    }
  };
  
  // 初始化
  useEffect(() => {
    if (!user || !user.team_id) {
      setError('请先登入并确认您有团队权限');
      setLoading(false);
      return;
    }
    
    fetchContestData();
  }, [contestId]);
  
  // 手動同步比賽結果
  const syncMatchResults = async () => {
    try {
      setSaving(true);
      
      if (!bracketStructure) {
        setError('賽制結構尚未初始化');
        return;
      }
      
      const fetchedMatchResults = await fetchMatchResults();
      setMatchResults(fetchedMatchResults); // 更新狀態
      
      const updatedBracket = updateBracketWithResults(bracketStructure, fetchedMatchResults);
      
      // 保存更新後的賽制結構
      const { error } = await supabase
        .from('contest')
        .update({ bracket_structure: updatedBracket })
        .eq('contest_id', contestId);
      
      if (error) throw error;
      
      setBracketStructure(updatedBracket);
      setSuccessMessage('比賽結果已同步，獲勝隊伍已自動晉級');
      setTimeout(() => setSuccessMessage(''), 3000);
      
    } catch (error: any) {
      console.error('同步比賽結果失敗:', error);
      setError('同步比賽結果失敗: ' + error.message);
    } finally {
      setSaving(false);
    }
  };
  
  // 主要渲染
  return (
    <div className="tournament-bracket-page">
      <h1>🏆 淘汰賽賽程圖</h1>
      
      {renderTopControls()}
      
      {smartOptions && smartOptions.actualTeams !== smartOptions.totalTeams && (
        <div style={{
          backgroundColor: '#fff3cd',
          border: '1px solid #fbbf24',
          borderRadius: '6px',
          padding: '12px',
          marginBottom: '16px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <span>⚠️</span>
          <span>實際報名 {smartOptions.actualTeams} 隊，預期 {smartOptions.totalTeams} 隊</span>
        </div>
      )}
      
      {error && <div className="error-message">❌ {error}</div>}
      {successMessage && <div className="success-message">✅ {successMessage}</div>}
      
      {loading ? (
        <div className="loading">載入中...</div>
      ) : (
        <div className="main-content" style={{ display: 'flex', gap: '20px' }}>
          {renderTeamsPanel()}
          <div style={{ flex: 1, overflowX: 'auto' }}>
            {renderMainContent()}
          </div>
        </div>
      )}
    </div>
  );
};

export default TournamentBracketPage;
