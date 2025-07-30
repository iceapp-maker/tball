import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";
import './TournamentBracketPage.css';

// 添加CSS動畫樣式
const pulseAnimation = `
  @keyframes pulse {
    0% {
      box-shadow: 0 0 0 0 rgba(255, 107, 53, 0.7);
    }
    70% {
      box-shadow: 0 0 0 10px rgba(255, 107, 53, 0);
    }
    100% {
      box-shadow: 0 0 0 0 rgba(255, 107, 53, 0);
    }
  }
`;

// 將動畫樣式注入到頁面
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = pulseAnimation;
  document.head.appendChild(style);
}

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
  seeds?: {
    team_ids: number[];
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
  const [smartOptions, setSmartOptions] = useState<SmartOptions | null>(null);
  const [bracketStructure, setBracketStructure] = useState<BracketStructure | null>(null);
  
  // 獲取登錄用戶信息
  const user = JSON.parse(localStorage.getItem('loginUser') || '{}');
  
  // 新增狀態：檢查是否已生成出賽單
  const [hasGeneratedLineup, setHasGeneratedLineup] = useState(false);
  
  // 新增狀態：檢查比賽是否可以結束
  const [canFinishContest, setCanFinishContest] = useState(false);
  const [finishingContest, setFinishingContest] = useState(false);
  
  // 移除決賽賽制配置相關狀態（簡化為單一淘汰賽）
  
  // 智能推薦邏輯 - 簡化為只支援標準淘汰賽
  const calculateRecommendedModes = (actualTeams: number, expectedTeams: number): TournamentMode[] => {
    const modes: TournamentMode[] = [];
    const totalTeams = Math.max(actualTeams, expectedTeams);
    
    // 標準淘汰賽
    modes.push({
      value: 'elimination',
      label: '標準淘汰賽',
      description: `${totalTeams}隊直接淘汰`,
      recommended: true,
      rounds: Math.ceil(Math.log2(Math.max(totalTeams, 2)))
    });
    
    return modes;
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

  // 更新賽制結構中的獲勝者和晉級 - 簡化為只處理標準淘汰賽
  const updateBracketWithResults = (
    currentBracket: BracketStructure, 
    matchResults: any[]
  ): BracketStructure => {
    const updatedBracket = JSON.parse(JSON.stringify(currentBracket));

    // 只處理標準淘汰賽
    if (updatedBracket.rounds) {
      // 第一次遍歷：更新所有比賽的獲勝者
      matchResults.forEach(match => {
        const winnerId = calculateMatchWinner(match.contest_match_detail);
        
        // 找到對應的比賽並更新獲勝者
        updatedBracket.rounds.forEach((round: RoundData, roundIndex: number) => {
          round.matches.forEach((bracketMatch: MatchData) => {
            if ((bracketMatch.team1Id === match.team1_id && bracketMatch.team2Id === match.team2_id) || 
                (bracketMatch.team1Id === match.team2_id && bracketMatch.team2Id === match.team1_id)) {
              
              bracketMatch.winnerId = winnerId;
            }
          });
        });
      });
      
      // 第二次遍歷：處理所有輪次的晉級邏輯
      for (let roundIndex = 0; roundIndex < updatedBracket.rounds.length - 1; roundIndex++) {
        const currentRound = updatedBracket.rounds[roundIndex];
        const nextRoundIndex = roundIndex + 1;
        
        currentRound.matches.forEach((match: MatchData) => {
          // 如果有獲勝者且有下一輪位置信息
          if (match.winnerId && match.nextMatchPosition && match.nextMatchTeamSlot) {
            if (nextRoundIndex < updatedBracket.rounds.length) {
              const nextMatch = updatedBracket.rounds[nextRoundIndex].matches.find(
                (m: MatchData) => m.position === match.nextMatchPosition
              );
              
              if (nextMatch) {
                if (match.nextMatchTeamSlot === 1) {
                  nextMatch.team1Id = match.winnerId;
                } else {
                  nextMatch.team2Id = match.winnerId;
                }
              }
            }
          }
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
    const team1Wins =       matchData.contest_match_detail.filter((detail: any) => 
      detail.winner_team_id === team1Id
    ).length;
    
    const team2Wins =       matchData.contest_match_detail.filter((detail: any) => 
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

      // 🎯 新增邏輯：從 bracket_structure 提取所有 teamId 並查詢隊伍資料
      if (contestData.bracket_structure) {
        const teamIdsInBracket = new Set<number>();
        const structure = contestData.bracket_structure;

        // 遍歷所有可能的賽程結構
        structure.rounds?.forEach((r: RoundData) => r.matches.forEach((m: MatchData) => {
          if (m.team1Id) teamIdsInBracket.add(m.team1Id);
          if (m.team2Id) teamIdsInBracket.add(m.team2Id);
        }));
        if (structure.groups) {
          Object.keys(structure.groups).forEach(groupId => {
            const g: GroupData = structure.groups![groupId];
            g.bracket.forEach((r: RoundData) => r.matches.forEach((m: MatchData) => {
              if (m.team1Id) teamIdsInBracket.add(m.team1Id);
              if (m.team2Id) teamIdsInBracket.add(m.team2Id);
            }));
          });
        }
        structure.final_stage?.bracket.forEach((r: RoundData) => r.matches.forEach((m: MatchData) => {
          if (m.team1Id) teamIdsInBracket.add(m.team1Id);
          if (m.team2Id) teamIdsInBracket.add(m.team2Id);
        }));

        if (teamIdsInBracket.size > 0) {
          const teamIdArray = Array.from(teamIdsInBracket);
          // 步驟 1: 先查詢基本的隊伍資料（移除 contest_id 限制，允許跨賽事查詢）
          const { data: baseTeams, error: baseTeamsError } = await supabase
            .from('contest_team')
            .select('*')
            .in('contest_team_id', teamIdArray);

          if (baseTeamsError) {
            console.error('從賽程表查詢隊伍基本資料失敗:', baseTeamsError);
            return; // 查詢失敗，提前退出
          }

          console.log('✅ 成功查詢到隊伍資料:', baseTeams?.length || 0, '支隊伍');

          // 步驟 2: 查詢所有相關隊伍的隊長
          const { data: captainsData, error: captainsError } = await supabase
            .from('contest_team_member')
            .select(`
              contest_team_id,
              member_name,
              member_id
            `)
            .in('contest_team_id', teamIdArray)
            .eq('status', 'captain');

          if (captainsError) {
            console.warn('查詢隊長資料失敗:', captainsError);
          }

          // 步驟 3: 將隊長名稱合併回隊伍資料
          const teamsWithCaptains = baseTeams.map((team: TeamData) => {
            const captain = captainsData?.find((c: any) => c.contest_team_id === team.contest_team_id);
            
            return {
              ...team,
              captain_name: captain?.member_name || '未指定',
            };
          });

          setTeams(teamsWithCaptains);
          console.log('✅ 成功從 bracket structure 載入', teamsWithCaptains.length, '支隊伍');
          
          // 🎯 關鍵修正：如果已經從 bracket_structure 成功載入隊伍，就跳過後續的載入邏輯
          // 避免被後續邏輯覆蓋
          console.log('🎯 已從 bracket_structure 載入隊伍，跳過後續載入邏輯');
        } else {
          console.log('⚠️ bracket_structure 中沒有隊伍 ID，繼續使用傳統載入邏輯');
        }
      } else {
        console.log('⚠️ 沒有 bracket_structure，使用傳統載入邏輯');
      }
      
      // 🎯 修正：只有在還沒載入隊伍時才執行傳統載入邏輯
      if (teams.length === 0) {
        console.log('🔄 開始傳統隊伍載入邏輯...');
        
        // 判斷是主賽事還是子賽事
        let teamsData = [];
      if (contestData.parent_contest_id) {
        // 子賽事（如決賽）：優先從種子隊伍獲取，然後從 contest_group_assignment 獲取
        let teamIds: number[] = [];
        
        // 如果有種子隊伍，先添加種子隊伍 ID
        if (contestData.bracket_structure?.seeds?.team_ids) {
          teamIds = [...contestData.bracket_structure.seeds.team_ids];
          console.log('從種子隊伍獲取隊伍 ID:', teamIds);
        }
        
        // 再從 contest_group_assignment 獲取其他隊伍
        const { data: groupAssignments, error: groupError } = await supabase
          .from('contest_group_assignment')
          .select('contest_team_id')
          .eq('group_contest_id', contestId);

        if (groupError) {
          console.warn('獲取分組分配失敗:', groupError);
        } else if (groupAssignments) {
          const groupTeamIds = groupAssignments.map((a: { contest_team_id: any; }) => a.contest_team_id);
          // 合併種子隊伍和分組隊伍，去除重複
          teamIds = [...new Set([...teamIds, ...groupTeamIds])];
        }

        if (teamIds.length > 0) {
          // 修正：移除 contest_id 限制，允許跨賽事查詢隊伍資料
          const { data: subTeamsData, error: subTeamsError } = await supabase
            .from('contest_team')
            .select('*')
            .in('contest_team_id', teamIds);

          if (subTeamsError) {
            console.error('獲取隊伍資料失敗:', subTeamsError);
            throw subTeamsError;
          }
          
          teamsData = subTeamsData || [];
          console.log('✅ 子賽事成功獲取隊伍資料:', teamsData.length, '支隊伍');
        } else {
          teamsData = [];
          console.log('⚠️ 沒有找到任何隊伍 ID');
        }

      } else {
        // 主賽事：從 contest_team 獲取隊伍
        const { data: mainTeamsData, error: mainTeamsError } = await supabase
          .from('contest_team')
          .select('*')
          .eq('contest_id', contestId);
        
        if (mainTeamsError) throw mainTeamsError;
        teamsData = mainTeamsData;
      }
      
      console.log('原始隊伍資料:', teamsData);

      // 🎯 修正：確保隊伍名稱完整載入
      const teamsWithNames = [];
      for (const team of teamsData || []) {
        let teamName = team.team_name;
        
        // 如果 contest_team 表中沒有 team_name 或為空，則從 courts 表查詢
        if (!teamName && team.team_id) {
          console.log(`隊伍 ${team.contest_team_id} 缺少名稱，從 courts 表查詢 team_id: ${team.team_id}`);
          try {
            const { data: courtData, error: courtError } = await supabase
              .from('courts')
              .select('name')
              .eq('team_id', team.team_id)
              .single();
            
            if (!courtError && courtData?.name) {
              teamName = courtData.name;
              console.log(`從 courts 表獲取到隊伍名稱: ${teamName}`);
            }
          } catch (err) {
            console.warn(`查詢 courts 表失敗，team_id: ${team.team_id}`, err);
          }
        }
        
        // 如果仍然沒有名稱，使用預設格式
        if (!teamName) {
          teamName = `隊伍 #${team.contest_team_id}`;
          console.warn(`隊伍 ${team.contest_team_id} 無法獲取名稱，使用預設名稱: ${teamName}`);
        }
        
        teamsWithNames.push({
          ...team,
          team_name: teamName
        });
      }
      
      console.log('補充名稱後的隊伍資料:', teamsWithNames);
      
      // 獲取隊長資訊 - 使用 member_name
      const teamsWithCaptains = [];
      for (const team of teamsWithNames) {
        const { data: captainData, error: captainError } = await supabase
          .from('contest_team_member')
          .select('contest_team_id, member_name')
          .eq('contest_team_id', team.contest_team_id)
          .eq('status', 'captain')
          .single();
        
        if (captainError) {
          console.warn(`查詢隊長失敗，team_id: ${team.contest_team_id}`, captainError);
        }
        
        teamsWithCaptains.push({
          ...team,
          captain_name: captainData?.member_name || '未指定'
        });
      }
      
        console.log('最終隊伍資料（含隊長）:', teamsWithCaptains);
        setTeams(teamsWithCaptains);
        
        // 生成智能選項
        const smartOpts = getSmartOptions(contestData, teamsWithCaptains.length);
        setSmartOptions(smartOpts);
      } else {
        console.log('🎯 隊伍已從 bracket_structure 載入，使用現有資料生成智能選項');
        const smartOpts = getSmartOptions(contestData, teams.length);
        setSmartOptions(smartOpts);
      }
      
      // 獲取比賽結果並更新賽制結構
      if (contestData.bracket_structure) {
        const fetchedMatchResults = await fetchMatchResults();
        setMatchResults(fetchedMatchResults); // 保存到狀態
        
        const updatedBracket = updateBracketWithResults(contestData.bracket_structure, fetchedMatchResults);
        
        // 只依據後端資料庫的winner_team_id決定晉級
        // 移除手動晉級邏輯，所有晉級均由已存在的勝者資料決定
        // 如果某輪沒有勝者，則不晉級
        
        // 🎯 修正：優先使用 updatedBracket（包含比賽結果），如果沒有則使用原始資料
        const finalBracketStructure = updatedBracket || contestData.bracket_structure;
        
        console.log('🔍 最終 bracketStructure 選擇:', {
          hasUpdatedBracket: !!updatedBracket,
          updatedBracketRounds: updatedBracket?.rounds?.length || 0,
          originalBracketRounds: contestData.bracket_structure?.rounds?.length || 0,
          finalChoice: finalBracketStructure === updatedBracket ? 'updatedBracket' : 'originalBracket'
        });
        
        // 檢查是否需要更新資料庫
        if (updatedBracket && JSON.stringify(updatedBracket) !== JSON.stringify(contestData.bracket_structure)) {
          console.log('🔄 更新資料庫中的 bracket_structure');
          await supabase
            .from('contest')
            .update({ bracket_structure: updatedBracket })
            .eq('contest_id', contestId);
          
          setSuccessMessage('賽程已同步最新比賽結果');
          setTimeout(() => setSuccessMessage(''), 3000);
        }
        
        // 🎯 關鍵修正：始終設置有效的 bracketStructure
        console.log('🔍 設置 bracketStructure:', finalBracketStructure);
        setBracketStructure(finalBracketStructure);
        
        // 🎯 修正：如果沒有正確的 match_mode，根據 bracket_structure 自動設置
        if (!contestData.match_mode && finalBracketStructure) {
          let detectedMode = 'elimination';
          if (finalBracketStructure.groups) {
            detectedMode = 'group_elimination_2';
          }
          
          console.log('🎯 自動檢測並設置賽制模式:', detectedMode);
          setContestData(prev => ({ ...prev, match_mode: detectedMode }));
        }
        
        setShowConfigWizard(false);
      }
      
      // 🎯 新增邏輯：如果是決賽賽事且有種子隊伍但沒有完整的bracket_structure，自動產生對戰表
      if (contestData.contest_type === 'playoff_stage' && 
          contestData.bracket_structure?.seeds?.team_ids?.length > 0 && 
          (!contestData.bracket_structure.rounds || contestData.bracket_structure.rounds.length === 0)) {
        console.log('🎯 檢測到決賽賽事有種子隊伍但沒有對戰表，自動產生對戰表結構');
        const seedTeamIds = contestData.bracket_structure.seeds.team_ids;
        const teamCount = seedTeamIds.length;
        
        // 自動產生標準淘汰賽結構
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
        
        const newBracketStructure: BracketStructure = {
          rounds,
          seeds: {
            team_ids: seedTeamIds
          }
        };
        
        // 更新到資料庫
        try {
          const { error: updateError } = await supabase
            .from('contest')
            .update({ bracket_structure: newBracketStructure })
            .eq('contest_id', contestId);
          
          if (!updateError) {
            setBracketStructure(newBracketStructure);
            setContestData(prev => ({ ...prev, bracket_structure: newBracketStructure }));
            setSuccessMessage('已自動產生決賽對戰表結構');
            setTimeout(() => setSuccessMessage(''), 3000);
            console.log('✅ 成功自動產生決賽對戰表結構');
          } else {
            console.error('❌ 自動產生對戰表結構失敗:', updateError);
          }
        } catch (err) {
          console.error('❌ 更新對戰表結構時發生錯誤:', err);
        }
      }
      // 檢查是否需要顯示配置精靈
      else if (!contestData.bracket_structure && contestData.match_mode === 'elimination') {
        setShowConfigWizard(true);
      }
      
    } catch (err: any) {
      console.error('獲取比賽資料失敗:', err);
      setError('獲取比賽資料失敗: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // 移除決賽配置相關函數（簡化為標準淘汰賽）
  
  // 【簡化】清除所有隊伍分配的函數 - 只處理標準淘汰賽
  const clearAllTeamAssignments = (structure: BracketStructure): BracketStructure => {
    const cleanStructure = JSON.parse(JSON.stringify(structure));
    
    // 只清除標準淘汰賽模式的分配
    if (cleanStructure.rounds) {
      cleanStructure.rounds.forEach((round: RoundData) => {
        round.matches.forEach((match: MatchData) => {
          match.team1Id = null;
          match.team2Id = null;
          match.winnerId = null;
        });
      });
    }
    
    return cleanStructure;
  };
  
  // 【修改】saveConfiguration 函數 - 簡化為只支援標準淘汰賽
  const saveConfiguration = async (mode: string) => {
    try {
      setSaving(true);
      
      // 只支援標準淘汰賽（使用修正版）
      const newBracketStructure = generateStandardEliminationFixed();
      
      // 確保新結構是乾淨的（沒有隊伍分配）
      const cleanBracketStructure = clearAllTeamAssignments(newBracketStructure);
      
      // 儲存到資料庫
      const { error } = await supabase
        .from('contest')
        .update({
          match_mode: 'elimination',
          bracket_structure: cleanBracketStructure
        })
        .eq('contest_id', contestId);
      
      if (error) throw error;
      
      setBracketStructure(cleanBracketStructure);
      setContestData(prev => ({ ...prev, match_mode: 'elimination', bracket_structure: cleanBracketStructure }));
      setShowConfigWizard(false);
      setSuccessMessage('標準淘汰賽配置儲存成功！所有隊伍分配已重置');
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
  
  // 移除雙組淘汰賽生成函數（簡化為單一淘汰賽）
  
  // 檢查隊伍是否已被分配到其他位置 - 簡化為只檢查標準淘汰賽
  const isTeamAlreadyAssigned = (teamId: number): boolean => {
    if (!bracketStructure) return false;
    
    // 只檢查標準淘汰賽模式
    if (bracketStructure.rounds) {
      for (const round of bracketStructure.rounds) {
        for (const match of round.matches) {
          if (match.team1Id === teamId || match.team2Id === teamId) {
            return true;
          }
        }
      }
    }
    
    return false;
  };
  
  // 移除隊伍從特定位置 - 簡化為只處理標準淘汰賽
  const removeTeamFromPosition = (teamId: number): BracketStructure | null => {
    if (!bracketStructure) return null;
    
    const updatedStructure = JSON.parse(JSON.stringify(bracketStructure));
    
    // 只從標準淘汰賽模式移除
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
  roundIndex: number
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
    
    // 只處理標準淘汰賽
    if (updatedBracketStructure.rounds) {
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
    
    // 重新檢查出賽單狀態，確保按鈕顯示正確
    await checkLineupGenerated();
    
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

  // 隊伍名稱快取
  const [teamNameCache, setTeamNameCache] = useState<{[key: number]: string}>({});

  // 獲取隊伍名稱 - 優先從本地狀態，其次從快取，最後從資料庫查詢
  const getTeamName = (teamId: number) => {
    // 1. 優先從本地 teams 狀態查找
    const team = teams.find(t => t.contest_team_id === teamId);
    if (team && team.team_name) {
      return team.team_name;
    }
    
    // 2. 從快取中查找
    if (teamNameCache[teamId]) {
      return teamNameCache[teamId];
    }
    
    // 3. 如果都找不到，觸發異步查詢並返回臨時名稱
    fetchTeamNameFromDatabase(teamId);
    return `隊伍 #${teamId}`;
  };

  // 從資料庫查詢隊伍名稱
  const fetchTeamNameFromDatabase = async (teamId: number) => {
    try {
      console.log(`[fetchTeamNameFromDatabase] 查詢隊伍名稱，teamId: ${teamId}`);
      
      const { data: teamData, error } = await supabase
        .from('contest_team')
        .select('team_name, team_id')
        .eq('contest_team_id', teamId)
        .single();

      if (error) {
        console.error(`[fetchTeamNameFromDatabase] 查詢失敗，teamId: ${teamId}`, error);
        return;
      }

      if (teamData) {
        let teamName = teamData.team_name;
        
        // 如果 contest_team 表中沒有 team_name，嘗試從 courts 表查詢
        if (!teamName && teamData.team_id) {
          console.log(`[fetchTeamNameFromDatabase] contest_team 表中無名稱，從 courts 表查詢 team_id: ${teamData.team_id}`);
          
          const { data: courtData, error: courtError } = await supabase
            .from('courts')
            .select('name')
            .eq('team_id', teamData.team_id)
            .single();
          
          if (!courtError && courtData?.name) {
            teamName = courtData.name;
            console.log(`[fetchTeamNameFromDatabase] 從 courts 表獲取到隊伍名稱: ${teamName}`);
          }
        }
        
        // 如果仍然沒有名稱，使用預設格式
        if (!teamName) {
          teamName = `隊伍 #${teamId}`;
          console.warn(`[fetchTeamNameFromDatabase] 無法獲取隊伍名稱，使用預設名稱: ${teamName}`);
        }
        
        // 更新快取
        setTeamNameCache(prev => ({
          ...prev,
          [teamId]: teamName
        }));
        
        console.log(`[fetchTeamNameFromDatabase] 成功獲取並快取隊伍名稱: ${teamId} => ${teamName}`);
      }
    } catch (err) {
      console.error(`[fetchTeamNameFromDatabase] 查詢隊伍名稱時發生錯誤，teamId: ${teamId}`, err);
    }
  };

  // 獲取比賽前四名
  const getTopFourTeams = () => {
    // 如果沒有比賽結構或結果，返回空數組
    if (!bracketStructure || !matchResults.length) return [];
    
    const topTeams: {rank: number, teamId: number, teamName: string}[] = [];
    
    // 處理雙組淘汰賽
    if (contestData?.match_mode === 'group_elimination_2' && bracketStructure.final_stage) {
      // 獲取決賽冠軍
      const finalMatch = bracketStructure.final_stage.bracket[0].matches[0];
      if (finalMatch.winnerId) {
        // 冠軍
        topTeams.push({
          rank: 1,
          teamId: finalMatch.winnerId,
          teamName: getTeamName(finalMatch.winnerId)
        });
        
        // 亞軍 (決賽輸家)
        const runnerUpId = finalMatch.team1Id === finalMatch.winnerId ? finalMatch.team2Id : finalMatch.team1Id;
        if (runnerUpId) {
          topTeams.push({
            rank: 2,
            teamId: runnerUpId,
            teamName: getTeamName(runnerUpId)
          });
        }
        
        // 找到A組和B組最後一輪的亞軍作為季軍和殿軍
        if (bracketStructure.groups) {
          const groups = Object.values(bracketStructure.groups);
          groups.forEach(group => {
            const lastRound = group.bracket[group.bracket.length - 1];
            if (lastRound && lastRound.matches.length > 0) {
              const lastMatch = lastRound.matches[0];
              if (lastMatch.winnerId && (lastMatch.team1Id || lastMatch.team2Id)) {
                const loserTeamId = lastMatch.team1Id === lastMatch.winnerId ? lastMatch.team2Id : lastMatch.team1Id;
                if (loserTeamId) {
                  topTeams.push({
                    rank: topTeams.length + 1, // 3 或 4
                    teamId: loserTeamId,
                    teamName: getTeamName(loserTeamId)
                  });
                }
              }
            }
          });
        }
      }
    } 
    // 處理標準淘汰賽和種子淘汰賽
    else if (bracketStructure.rounds) {
      // 最後一輪是決賽
      const finalRound = bracketStructure.rounds[bracketStructure.rounds.length - 1];
      if (finalRound && finalRound.matches.length > 0) {
        const finalMatch = finalRound.matches[0];
        if (finalMatch.winnerId) {
          // 冠軍
          topTeams.push({
            rank: 1,
            teamId: finalMatch.winnerId,
            teamName: getTeamName(finalMatch.winnerId)
          });
          
          // 亞軍 (決賽輸家)
          const runnerUpId = finalMatch.team1Id === finalMatch.winnerId ? finalMatch.team2Id : finalMatch.team1Id;
          if (runnerUpId) {
            topTeams.push({
              rank: 2,
              teamId: runnerUpId,
              teamName: getTeamName(runnerUpId)
            });
          }
        }
        
        // 半決賽輪次
        if (bracketStructure.rounds.length > 1) {
          const semiRound = bracketStructure.rounds[bracketStructure.rounds.length - 2];
          if (semiRound && semiRound.matches.length > 0) {
            // 收集半決賽輸家作為季軍和殿軍
            semiRound.matches.forEach(match => {
              if (match.winnerId && (match.team1Id || match.team2Id)) {
                const loserTeamId = match.team1Id === match.winnerId ? match.team2Id : match.team1Id;
                if (loserTeamId) {
                  topTeams.push({
                    rank: topTeams.length + 1, // 3 或 4
                    teamId: loserTeamId,
                    teamName: getTeamName(loserTeamId)
                  });
                }
              }
            });
          }
        }
      }
    }
    
    return topTeams.slice(0, 4); // 確保只返回前4名
  };
  
  // 計算應該有的比賽總數
  const calculateExpectedMatchCount = () => {
    if (!bracketStructure) return 0;
    
    let expectedCount = 0;
    
    // 處理標準淘汰賽
    if (bracketStructure.rounds) {
      bracketStructure.rounds.forEach(round => {
        expectedCount += round.matches.length;
      });
    }
    
    // 處理雙組淘汰賽
    if (bracketStructure.groups) {
      // 計算各組內比賽
      Object.values(bracketStructure.groups).forEach((group: GroupData) => {
        group.bracket.forEach(round => {
          expectedCount += round.matches.length;
        });
      });
      
      // 計算決賽階段比賽
      if (bracketStructure.final_stage) {
        bracketStructure.final_stage.bracket.forEach(round => {
          expectedCount += round.matches.length;
        });
      }
    }
    
    return expectedCount;
  };

  // 檢查決賽是否已完成
  const checkFinalCompleted = () => {
    if (!bracketStructure) return false;
    
    // 檢查標準淘汰賽
    if (bracketStructure.rounds && bracketStructure.rounds.length > 0) {
      const finalRound = bracketStructure.rounds[bracketStructure.rounds.length - 1];
      if (finalRound && finalRound.matches && finalRound.matches.length > 0) {
        // 檢查決賽是否有獲勝者
        const finalMatch = finalRound.matches[0];
        return finalMatch.winnerId !== null && finalMatch.winnerId !== undefined;
      }
    }
    
    // 檢查雙組淘汰賽的決賽階段
    if (bracketStructure.final_stage && bracketStructure.final_stage.bracket) {
      for (const round of bracketStructure.final_stage.bracket) {
        // 檢查所有決賽階段的比賽是否都已完成
        const allMatchesCompleted = round.matches.every(match => 
          match.winnerId !== null && match.winnerId !== undefined
        );
        
        if (!allMatchesCompleted) {
          return false;
        }
      }
      return true;
    }
    
    return false;
  };

  // 檢查所有比賽是否已完成
  const checkAllMatchesCompleted = async () => {
    try {
      const { data: matchDetails, error } = await supabase
        .from('contest_match_detail')
        .select('score, winner_team_id')
        .eq('contest_id', contestId);

      if (error) throw error;
      
      // 檢查是否所有比賽詳情都有獲勝者
      return matchDetails && matchDetails.length > 0 && matchDetails.every(
        (detail: any) => detail.winner_team_id !== null
      );
    } catch (error) {
      console.error('檢查比賽完成狀態失敗:', error);
      return false;
    }
  };

  // 處理子賽事晉級邏輯
  const handleSubContestAdvancement = async () => {
    if (!contestId || !contestData?.advancement_rules) return;
    
    console.log('開始處理子賽事晉級邏輯:', contestId);
    
    // 獲取晉級隊伍數量
    let advancementCount = 1; // 預設值
    if (contestData.advancement_rules?.advancement_count) {
      advancementCount = contestData.advancement_rules.advancement_count;
    } else if (contestData.advancement_rules?.advances) {
      advancementCount = contestData.advancement_rules.advances;
    } else if (contestData.advancement_team_count) {
      advancementCount = contestData.advancement_team_count;
    }
    
    console.log('最終晉級隊伍數量:', advancementCount);
    
    // 獲取比賽結果
    const contestResults = await fetchMatchResults();
    console.log('比賽結果:', contestResults);
    
    // 從比賽記錄中獲取實際參賽隊伍
    const allTeamIds = new Set<number>();
    contestResults?.forEach(match => {
      if (match.team1_id) allTeamIds.add(match.team1_id);
      if (match.team2_id) allTeamIds.add(match.team2_id);
    });
    
    // 獲取隊伍名稱
    const { data: teamDetails, error: teamDetailsError } = await supabase
      .from('contest_team')
      .select('contest_team_id, team_name')
      .in('contest_team_id', Array.from(allTeamIds));
    
    if (teamDetailsError) {
      console.error('獲取隊伍詳情失敗:', teamDetailsError);
      throw teamDetailsError;
    }
    
    // 統計各隊勝場數
    const teamStats: { [key: string]: { wins: number; teamName: string } } = {};
    
    // 初始化隊伍統計
    teamDetails?.forEach(team => {
      teamStats[team.contest_team_id] = {
        wins: 0,
        teamName: team.team_name || `隊伍 #${team.contest_team_id}`
      };
    });
    
    // 統計勝場
    contestResults?.forEach(match => {
      const winnerId = calculateMatchWinner(match.contest_match_detail);
      if (winnerId && teamStats[winnerId]) {
        teamStats[winnerId].wins++;
      }
    });
    
    console.log('隊伍統計:', teamStats);
    
    // 按勝場數排序，取前N名晉級
    const sortedTeams = Object.entries(teamStats)
      .map(([teamId, stats]) => ({
        contest_team_id: parseInt(teamId),
        team_name: stats.teamName,
        wins: stats.wins
      }))
      .sort((a, b) => b.wins - a.wins)
      .slice(0, advancementCount);
    
    console.log('晉級隊伍:', sortedTeams);
    
    // 處理晉級和淘汰隊伍
    const qualifiedTeamIds = sortedTeams.map(team => team.contest_team_id);
    const allParticipatingTeamIds = Array.from(allTeamIds);
    
    console.log('所有參賽隊伍:', allParticipatingTeamIds);
    console.log('晉級隊伍:', qualifiedTeamIds);
    
    // 將晉級隊伍從 contest_group_assignment 表中移除（讓它們回到待排清單）
    if (qualifiedTeamIds.length > 0) {
      const { error: removeQualifiedError } = await supabase
        .from('contest_group_assignment')
        .delete()
        .eq('group_contest_id', contestId)
        .in('contest_team_id', qualifiedTeamIds);
      
      if (removeQualifiedError) {
        console.error('移除晉級隊伍失敗:', removeQualifiedError);
        throw removeQualifiedError;
      } else {
        console.log(`成功將 ${qualifiedTeamIds.length} 支晉級隊伍從 contest_group_assignment 表中移除`);
      }
    }
    
    // 被淘汰隊伍保留在 contest_group_assignment 表中（不需要額外處理）
    const eliminatedTeamIds = allParticipatingTeamIds.filter(teamId => 
      !qualifiedTeamIds.includes(teamId)
    );
    console.log(`被淘汰隊伍 ${eliminatedTeamIds.length} 支保留在 contest_group_assignment 表中`);
    
    console.log('晉級處理完成');
  };

  // 結束比賽
  const handleFinishContest = async () => {
    if (!canFinishContest || finishingContest) return;
    
    if (!confirm('確定要結束比賽嗎？結束後將無法再修改比賽結果。')) {
      return;
    }
    
    try {
      setFinishingContest(true);
      
      // 如果這是子賽事且有晉級規則，處理晉級/淘汰邏輯
      if (contestData?.parent_contest_id && contestData?.advancement_rules) {
        console.log('處理子賽事晉級邏輯...');
        await handleSubContestAdvancement();
      }
      
      // 更新當前子賽事狀態為已結束
      const { error: subContestError } = await supabase
        .from('contest')
        .update({ contest_status: 'finished' })
        .eq('contest_id', contestId);

      if (subContestError) throw subContestError;
      
      // 如果這是子賽事，同時更新主賽事狀態
      if (contestData?.parent_contest_id) {
        const { error: mainContestError } = await supabase
          .from('contest')
          .update({ contest_status: 'finished' })
          .eq('contest_id', contestData.parent_contest_id);

        if (mainContestError) throw mainContestError;
      }
      
      // 更新本地狀態
      if (contestData) {
        setContestData({
          ...contestData,
          contest_status: 'finished'
        });
      }
      
      setSuccessMessage('比賽已成功結束！');
      setTimeout(() => setSuccessMessage(''), 3000);
      
    } catch (error: any) {
      console.error('結束比賽失敗:', error);
      setError('結束比賽失敗: ' + error.message);
    } finally {
      setFinishingContest(false);
    }
  };

  // 檢查是否有隊伍被安排到對戰位置
  const hasTeamsAssigned = () => {
    if (!bracketStructure) return false;
    
    // 檢查標準淘汰賽
    if (bracketStructure.rounds) {
      for (const round of bracketStructure.rounds) {
        for (const match of round.matches) {
          if (match.team1Id || match.team2Id) {
            return true; // 找到至少一個已安排的隊伍
          }
        }
      }
    }
    
    // 檢查雙組淘汰賽
    if (bracketStructure.groups) {
      // 檢查各組內比賽
      for (const group of Object.values(bracketStructure.groups)) {
        for (const round of (group as GroupData).bracket) {
          for (const match of round.matches) {
            if (match.team1Id || match.team2Id) {
              return true; // 找到至少一個已安排的隊伍
            }
          }
        }
      }
      
      // 檢查決賽階段
      if (bracketStructure.final_stage) {
        for (const round of bracketStructure.final_stage.bracket) {
          for (const match of round.matches) {
            if (match.team1Id || match.team2Id) {
              return true; // 找到至少一個已安排的隊伍
            }
          }
        }
      }
    }
    
    return false; // 沒有找到任何已安排的隊伍
  };

  // 檢查是否已生成出賽單
  const checkLineupGenerated = async () => {
    try {
      // 獲取實際的比賽記錄數量
      const { data: existingMatches, error: matchError } = await supabase
        .from('contest_match')
        .select('match_id')
        .eq('contest_id', contestId);
      
      if (matchError) throw matchError;
      
      const actualMatchCount = existingMatches ? existingMatches.length : 0;
      const expectedMatchCount = calculateExpectedMatchCount();
      
      // 只有當實際比賽數量 >= 預期比賽數量時，才認為已完全生成
      const hasGenerated = actualMatchCount >= expectedMatchCount && expectedMatchCount > 0;
      
      console.log('檢查出賽單狀態:', {
        contestId,
        actualMatchCount,
        expectedMatchCount,
        hasGenerated,
        bracketStructure: !!bracketStructure
      });
      
      setHasGeneratedLineup(hasGenerated);
      return hasGenerated;
    } catch (error) {
      console.error('檢查出賽單狀態失敗:', error);
      return false;
    }
  };

  // 通知隊長排出賽單的函式（保留原有功能）
  const notifyCaptainsForLineup = async () => {
    try {
      setSaving(true);
      
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
      
      // 更新比賽狀態為進行中
      await supabase
        .from('contest')
        .update({ contest_status: 'ongoing' })
        .eq('contest_id', contestId);
      
      // 更新本地狀態
      if (contestData) {
        setContestData({
          ...contestData,
          contest_status: 'ongoing'
        });
      }
      
      // 觸發通知更新事件
      try {
        const updateEvent = new Event('updateNotificationCount');
        window.dispatchEvent(updateEvent);
      } catch (eventError) {
        console.error('觸發通知更新事件失敗:', eventError);
      }
      
      setSuccessMessage('已成功通知隊長排出選手出賽單');
      setTimeout(() => setSuccessMessage(''), 3000);
      
      // 更新已生成出賽單狀態
      setHasGeneratedLineup(true);
      
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
      saveConfiguration(mode.value);
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
          
          {/* 種子設置界面已移除 */}
          
          {configStep === 2 && (
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
                  onClick={() => saveConfiguration(selectedMode)}
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
    console.log('🔍 renderStandardElimination 檢查:', {
      bracketStructure,
      hasRounds: !!bracketStructure?.rounds,
      roundsLength: bracketStructure?.rounds?.length
    });
    
    if (!bracketStructure?.rounds) {
      console.log('❌ renderStandardElimination: 沒有 rounds 資料，返回 null');
      return null;
    }
    
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
  
  // 移除雙組淘汰賽UI渲染函數（簡化為單一淘汰賽）
  
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
            disabled={saving || hasMatchResults()}
            title={hasMatchResults() ? '比賽已開始，無法重新配置賽制' : '重新配置賽制將清除所有資料'}
            style={{
              padding: '12px 20px',
              backgroundColor: '#dc3545',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              fontWeight: 'bold',
              cursor: (saving || hasMatchResults()) ? 'not-allowed' : 'pointer',
              opacity: (saving || hasMatchResults()) ? 0.6 : 1,
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
          
          {(() => {
            // 判斷按鈕狀態
            const teamsAssigned = hasTeamsAssigned();
            const canGenerate = bracketStructure && !hasGeneratedLineup && !saving && teamsAssigned;
            const isDisabled = !canGenerate || hasGeneratedLineup;
            
            return (
              <button 
                className="notify-btn" 
                onClick={notifyCaptainsForLineup}
                disabled={isDisabled}
                style={{
                  padding: '12px 20px',
                  backgroundColor: canGenerate ? '#ff6b35' : '#6c757d',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  fontWeight: 'bold',
                  cursor: isDisabled ? 'not-allowed' : 'pointer',
                  opacity: isDisabled ? 0.6 : 1,
                  transition: 'all 0.3s ease',
                  whiteSpace: 'nowrap',
                  animation: canGenerate ? 'pulse 2s infinite' : 'none',
                  boxShadow: canGenerate ? '0 0 0 4px rgba(255, 107, 53, 0.3)' : 'none'
                }}
                onMouseEnter={(e) => {
                  if (canGenerate) {
                    e.currentTarget.style.backgroundColor = '#e55a2b';
                    e.currentTarget.style.transform = 'translateY(-2px)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (canGenerate) {
                    e.currentTarget.style.backgroundColor = '#ff6b35';
                    e.currentTarget.style.transform = 'translateY(0)';
                  }
                }}
              >
                {saving ? '通知中...' : hasGeneratedLineup ? '已生成出賽單' : '⚠️ 通知隊長排出賽單'}
              </button>
            );
          })()}
          
          {/* 結束比賽按鈕 */}
          {canFinishContest && contestData?.contest_status !== 'finished' && (
            <button 
              className="finish-btn" 
              onClick={handleFinishContest}
              disabled={finishingContest}
              style={{
                padding: '12px 20px',
                backgroundColor: '#dc3545',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontWeight: 'bold',
                cursor: finishingContest ? 'not-allowed' : 'pointer',
                opacity: finishingContest ? 0.6 : 1,
                transition: 'all 0.2s ease',
                whiteSpace: 'nowrap'
              }}
              onMouseEnter={(e) => {
                if (!finishingContest) e.currentTarget.style.backgroundColor = '#c82333';
              }}
              onMouseLeave={(e) => {
                if (!finishingContest) e.currentTarget.style.backgroundColor = '#dc3545';
              }}
            >
              {finishingContest ? '結束中...' : '🏁 結束比賽'}
            </button>
          )}
          
          <button 
            className="back-btn" 
            onClick={() => {
              // 計算最後一輪的輪次號碼
              let lastRound = 1;
              
              if (bracketStructure) {
                if (bracketStructure.rounds) {
                  // 標準淘汰賽：最後一輪
                  lastRound = bracketStructure.rounds.length;
                } else if (bracketStructure.groups) {
                  // 雙組淘汰賽：決賽階段為最後一輪，使用特殊編號
                  if (bracketStructure.final_stage && bracketStructure.final_stage.bracket.length > 0) {
                    lastRound = 100; // 決賽階段使用100+輪次的編號
                  } else {
                    // 如果沒有決賽階段，找各組中最大的輪次
                    let maxRound = 1;
                    Object.values(bracketStructure.groups).forEach((group: GroupData) => {
                      maxRound = Math.max(maxRound, group.bracket.length);
                    });
                    lastRound = maxRound;
                  }
                }
              }
              
              // 跳轉到戰況室的最後一輪
              navigate(`/contest/${contestId}/battleroom?round=${lastRound}`);
            }}
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
  
  // 檢查是否已有比賽結果（用來決定是否禁用重新配置按鈕）
  const hasMatchResults = (): boolean => {
    // 只檢查資料庫中的真實比賽結果
    if (matchResults && matchResults.length > 0) {
      // 進一步檢查是否有任何比賽結果的勝者記錄
      for (const match of matchResults) {
        // 檢查比賽詳細資料中是否有勝利隊伍記錄
        if (match.contest_match_detail && match.contest_match_detail.length > 0) {
          for (const detail of match.contest_match_detail) {
            if (detail.winner_team_id) {
              // 發現真實比賽結果，應禁用重新配置按鈕
              return true;
            }
          }
        }
      }
    }
    
    return false; // 沒有真實比賽結果，可以使用重新配置按鈕
  };
  
  // 獲取前4名隊伍的函數
  const getTop4Teams = (): { teamId: number | null, rank: number, teamName: string, isShared?: boolean }[] => {
    const top4: { teamId: number | null, rank: number, teamName: string, isShared?: boolean }[] = [];
    
    // 處理標準淘汰賽和種子淘汰賽的情況
    if (bracketStructure && bracketStructure.rounds && bracketStructure.rounds.length > 0) {
      // 決賽應該在最後一輪
      const finalRound = bracketStructure.rounds[bracketStructure.rounds.length - 1];
      
      // 在決賽中找有勝者的比賽
      const finalMatches = finalRound.matches.filter(match => match.winnerId !== null);
      
      // 如果有決賽結果
      if (finalMatches.length > 0) {
        // 找到冠軍賽（通常是最後一場）
        const championshipMatch = finalMatches[0];
        
        // 第1名：決賽勝者
        if (championshipMatch.winnerId) {
          top4.push({
            teamId: championshipMatch.winnerId,
            rank: 1,
            teamName: getTeamName(championshipMatch.winnerId)
          });
          
          // 第2名：決賽敗者
          const secondPlaceTeamId = championshipMatch.team1Id === championshipMatch.winnerId ? 
            championshipMatch.team2Id : championshipMatch.team1Id;
          
          if (secondPlaceTeamId) {
            top4.push({
              teamId: secondPlaceTeamId,
              rank: 2,
              teamName: getTeamName(secondPlaceTeamId)
            });
          }
        }
        
        // 處理第3名和第4名
        if (bracketStructure.rounds.length >= 2) {
          // 找出半決賽輪次
          const semifinalRound = bracketStructure.rounds[bracketStructure.rounds.length - 2];
          const losersFromSemifinals: { teamId: number | null, matchId: string }[] = [];
          
          // 收集半決賽的敗者
          semifinalRound.matches.forEach(match => {
            if (match.winnerId) {
              // 半決賽敗者
              const loserTeamId = match.team1Id === match.winnerId ? match.team2Id : match.team1Id;
              if (loserTeamId) {
                losersFromSemifinals.push({
                  teamId: loserTeamId,
                  matchId: match.matchId
                });
              }
            }
          });
          
          // 查看是否有3/4名決賽
          const thirdPlaceMatch = finalMatches.find(match => 
            match !== championshipMatch && match.winnerId !== null
          );
          
          if (thirdPlaceMatch && thirdPlaceMatch.winnerId) {
            // 有3/4名決賽
            top4.push({
              teamId: thirdPlaceMatch.winnerId,
              rank: 3,
              teamName: getTeamName(thirdPlaceMatch.winnerId)
            });
            
            const fourthPlaceId = thirdPlaceMatch.team1Id === thirdPlaceMatch.winnerId ? 
              thirdPlaceMatch.team2Id : thirdPlaceMatch.team1Id;
              
            if (fourthPlaceId) {
              top4.push({
                teamId: fourthPlaceId,
                rank: 4,
                teamName: getTeamName(fourthPlaceId)
              });
            }
          } else {
            // 沒有3/4名決賽，將半決賽敗者設為並列第3名
            losersFromSemifinals.forEach(loser => {
              if (loser.teamId) {
                top4.push({
                  teamId: loser.teamId,
                  rank: 3,
                  teamName: getTeamName(loser.teamId),
                  isShared: true // 標記為併列
                });
              }
            });
          }
        }
      }
    }
    
    // 檢查雙組淘汰賽的決賽階段
    else if (bracketStructure && bracketStructure.final_stage) {
      const finalMatch = bracketStructure.final_stage.bracket[0]?.matches[0];
      
      if (finalMatch && finalMatch.winnerId) {
        // 第1名：決賽勝者
        top4.push({
          teamId: finalMatch.winnerId,
          rank: 1,
          teamName: getTeamName(finalMatch.winnerId)
        });
        
        // 第2名：決賽敗者
        const secondPlaceTeamId = finalMatch.team1Id === finalMatch.winnerId ? finalMatch.team2Id : finalMatch.team1Id;
        if (secondPlaceTeamId) {
          top4.push({
            teamId: secondPlaceTeamId,
            rank: 2,
            teamName: getTeamName(secondPlaceTeamId)
          });
        }
        
        // 處理雙組淘汰賽的情況 - 檢查3-4名決賽結果
        if (contestData?.match_mode === 'group_elimination_2' && bracketStructure.final_stage) {
          // 查找3-4名決賽 (position 2)
          const thirdPlaceMatch = bracketStructure.final_stage.bracket[0]?.matches.find(
            (m: MatchData) => m.position === 2
          );
          
          if (thirdPlaceMatch && thirdPlaceMatch.winnerId) {
            // 有3-4名決賽結果
            top4.push({
              teamId: thirdPlaceMatch.winnerId,
              rank: 3,
              teamName: getTeamName(thirdPlaceMatch.winnerId)
            });
            
            // 第4名是3-4名決賽的敗者
            const fourthPlaceId = thirdPlaceMatch.team1Id === thirdPlaceMatch.winnerId ? 
              thirdPlaceMatch.team2Id : thirdPlaceMatch.team1Id;
              
            if (fourthPlaceId) {
              top4.push({
                teamId: fourthPlaceId,
                rank: 4,
                teamName: getTeamName(fourthPlaceId)
              });
            }
          } else {
            // 沒有3-4名決賽結果，回退到原來的邏輯（A組亞軍 vs B組亞軍）
            const groupA = bracketStructure.groups?.['A'];
            const groupB = bracketStructure.groups?.['B'];
            
            if (groupA && groupB) {
              // A組亞軍
              const lastRoundA = groupA.bracket[groupA.bracket.length - 1];
              const matchA = lastRoundA?.matches[0];
              if (matchA && matchA.winnerId) {
                const runnerUpA = matchA.team1Id === matchA.winnerId ? matchA.team2Id : matchA.team1Id;
                if (runnerUpA) {
                  top4.push({
                    teamId: runnerUpA,
                    rank: 3,
                    teamName: getTeamName(runnerUpA),
                    isShared: true // 標記為並列，因為沒有實際對戰
                  });
                }
              }
              
              // B組亞軍
              const lastRoundB = groupB.bracket[groupB.bracket.length - 1];
              const matchB = lastRoundB?.matches[0];
              if (matchB && matchB.winnerId) {
                const runnerUpB = matchB.team1Id === matchB.winnerId ? matchB.team2Id : matchB.team1Id;
                if (runnerUpB) {
                  top4.push({
                    teamId: runnerUpB,
                    rank: 3, // 也是第3名，因為沒有實際對戰決出第4名
                    teamName: getTeamName(runnerUpB),
                    isShared: true // 標記為並列
                  });
                }
              }
            }
          }
        }
      }
    }
    
    return top4;
  };

  // 渲染左側隊伍面板 
  const renderTeamsPanel = () => {
    // 獲取前4名隊伍
    const top4Teams = getTop4Teams();
    const hasFinalWinner = top4Teams.length > 0;
    
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
          {hasFinalWinner ? '比賽結果' : '參賽隊伍'}
        </h2>
        
        {/* 比賽前4名結果展示 */}
        {hasFinalWinner && (
          <div style={{ 
            marginBottom: '24px',
            backgroundColor: '#f0f7ff',
            borderRadius: '6px',
            padding: '16px',
            border: '1px solid #bfdbfe'
          }}>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '16px', color: '#1e40af' }}>最終排名</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {top4Teams.map((team, index) => (
                <div key={`top-${team.rank}-${team.teamId || index}`} style={{ 
                  display: 'flex', 
                  alignItems: 'center',
                  padding: '8px 12px',
                  backgroundColor: team.rank === 1 ? '#fef3c7' : '#fff',
                  borderRadius: '4px',
                  border: `1px solid ${team.rank === 1 ? '#fcd34d' : '#e5e7eb'}`
                }}>
                  <div style={{
                    minWidth: '24px',
                    height: '24px',
                    borderRadius: '50%',
                    backgroundColor: 
                      team.rank === 1 ? '#f59e0b' : 
                      team.rank === 2 ? '#6b7280' : 
                      team.rank === 3 ? '#b45309' : '#94a3b8',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 'bold',
                    fontSize: '14px',
                    marginRight: '12px'
                  }}>
                    {team.rank}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 'bold' }}>{team.teamName}</div>
                    <div style={{ fontSize: '12px', color: '#6b7280' }}>
                      {team.rank === 1 ? '冠軍' : 
                       team.rank === 2 ? '亞軍' : 
                       team.rank === 3 && team.isShared ? '季軍(併列)' : 
                       team.rank === 3 ? '季軍' : ''}
                    </div>
                  </div>
                  {team.rank === 1 && (
                    <div style={{ fontSize: '20px', marginLeft: '8px' }}>🏆</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        
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
  
  // 渲染主要内容 - 簡化為只支援標準淘汰賽
  const renderMainContent = () => {
    if (loading) {
      return <div style={{textAlign: 'center', padding: '40px'}}>載入中...</div>;
    }
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
          <h3 style={{ color: '#666', marginBottom: '16px' }}>尚未配置賽制</h3>
          <p style={{ color: '#888', marginBottom: '20px' }}>請使用配置精靈設置標準淘汰賽</p>
          <button 
            className="save-btn"
            onClick={() => setShowConfigWizard(true)}
          >
            開始配置
          </button>
        </div>
      );
    }
    
    // 只支援標準淘汰賽
    return renderStandardElimination();
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
  
  // 這裡已移除重複的notifyCaptainsForLineup函數，修改了下面的原有函數
  
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
  
  // 🎯 Debug: 查詢 team_id 為 86 的隊伍名稱
  const [debugTeam86, setDebugTeam86] = useState<any>(null);
  
  // 檢查比賽是否可以結束
  useEffect(() => {
    const checkCanFinish = async () => {
      if (!contestData || contestData.contest_status === 'finished') {
        setCanFinishContest(false);
        return;
      }
      
      const finalCompleted = checkFinalCompleted();
      const allCompleted = await checkAllMatchesCompleted();
      
      // 只有當決賽完成且所有比賽都完成時才能結束比賽
      setCanFinishContest(finalCompleted && allCompleted);
    };
    
    if (contestId && bracketStructure) {
      checkCanFinish();
    }
  }, [contestId, bracketStructure, contestData]);

  // 主要的初始化useEffect
  useEffect(() => {
    if (contestId) {
      fetchContestData();
    }
  }, [contestId]);

  // 當 bracketStructure 變化時重新檢查出賽單狀態
  useEffect(() => {
    if (contestId && bracketStructure) {
      checkLineupGenerated();
    }
  }, [contestId, bracketStructure]);

  // 通用版：生成任意隊伍數量的標準淘汰賽結構（含季軍賽）
  const generateStandardEliminationFixed = (): BracketStructure => {
    const teamCount = teams.length;
    
    if (teamCount <= 1) {
      return { rounds: [] };
    }
    
    console.log(`開始生成${teamCount}隊淘汰賽結構`);
    
    const rounds: RoundData[] = [];
    let currentRoundTeams = teamCount;
    let roundNumber = 1;
    let eliminatedTeams: number[] = []; // 記錄每輪被淘汰的隊伍數
    
    // 核心邏輯：只要還有超過1支隊伍，就需要繼續比賽
    while (currentRoundTeams > 1) {
      const matches: MatchData[] = [];
      
      // 計算本輪需要多少場比賽
      const matchCount = Math.floor(currentRoundTeams / 2);
      const byeTeams = currentRoundTeams % 2; // 輪空隊伍數
      
      console.log(`第${roundNumber}輪: ${currentRoundTeams}隊 -> ${matchCount}場比賽 + ${byeTeams}隊輪空`);
      
      // 記錄本輪被淘汰的隊伍數
      eliminatedTeams.push(matchCount); // 每場比賽淘汰1隊
      
      // 創建比賽
      for (let matchIndex = 0; matchIndex < matchCount; matchIndex++) {
        const position = matchIndex + 1;
        
        // 計算晉級邏輯
        const nextRoundTeams = matchCount + byeTeams;
        const hasNextRound = nextRoundTeams > 1;
        
        let nextMatchPosition = null;
        let nextMatchTeamSlot = null;
        
        if (hasNextRound) {
          const nextRoundMatches = Math.floor(nextRoundTeams / 2);
          
          if (position <= nextRoundMatches * 2) {
            nextMatchPosition = Math.ceil(position / 2);
            nextMatchTeamSlot = (position % 2 === 1) ? 1 : 2;
          } else {
            const excessMatches = matchCount - nextRoundMatches;
            if (matchIndex >= matchCount - excessMatches) {
              nextMatchPosition = nextRoundMatches + (matchIndex - (matchCount - excessMatches)) + 1;
              nextMatchTeamSlot = 2;
            }
          }
        }
        
        matches.push({
          position,
          team1Id: null,
          team2Id: null,
          winnerId: null,
          nextMatchPosition,
          nextMatchTeamSlot
        });
      }
      
      rounds.push({
        round: roundNumber,
        matches
      });
      
      // 計算下一輪的隊伍數量
      const winnersFromMatches = matchCount;
      currentRoundTeams = winnersFromMatches + byeTeams;
      roundNumber++;
      
      // 安全檢查
      if (roundNumber > 20) {
        console.error('輪次超過20輪，可能有邏輯錯誤');
        break;
      }
    }
    
    // 檢查是否需要季軍賽
    const needsThirdPlaceMatch = checkNeedsThirdPlaceMatch(teamCount, eliminatedTeams);
    
    if (needsThirdPlaceMatch) {
      console.log('偵測到無法確定第3、4名，自動添加季軍決賽');
      addThirdPlaceMatch(rounds);
    }
    
    console.log('最終生成的淘汰賽結構:');
    rounds.forEach((round, index) => {
      console.log(`第${round.round}輪: ${round.matches.length}場比賽`);
    });
    
    return { rounds };
  };

  // 檢查是否需要季軍賽
  const checkNeedsThirdPlaceMatch = (teamCount: number, eliminatedTeams: number[]): boolean => {
    // 如果隊伍數量不是2的冪次，通常需要季軍賽來確定第3、4名
    const isPowerOfTwo = (teamCount & (teamCount - 1)) === 0;
    
    if (isPowerOfTwo) {
      // 2的冪次（4, 8, 16隊等）通常有明確的第3、4名
      return false;
    }
    
    // 非2的冪次，檢查是否會有多個並列第3名
    if (teamCount >= 5) {
      // 5隊以上的奇數隊伍，通常需要季軍賽
      return true;
    }
    
    return false;
  };

  // 添加季軍決賽
  const addThirdPlaceMatch = (rounds: RoundData[]) => {
    if (rounds.length < 2) return;
    
    // 在最後一輪（決賽）添加季軍賽
    const finalRound = rounds[rounds.length - 1];
    
    // 添加季軍決賽（第3、4名決定賽）
    finalRound.matches.push({
      position: finalRound.matches.length + 1,
      team1Id: null, // 準決賽敗者1
      team2Id: null, // 準決賽敗者2
      winnerId: null,
      nextMatchPosition: null,
      nextMatchTeamSlot: null
    });
    
    console.log('已添加季軍決賽到最後一輪');
  };

  // 移除決賽配置檢查邏輯（簡化為標準淘汰賽）

  useEffect(() => {
    const fetchTeam86Debug = async () => {
      try {
        console.log('🔍 開始查詢 team_id 為 86 的隊伍資料...');
        
        // 1. 從 contest_team 表查詢
        const { data: contestTeamData, error: contestTeamError } = await supabase
          .from('contest_team')
          .select('*')
          .eq('contest_team_id', 86);
        
        console.log('📊 contest_team 查詢結果 (contest_team_id=86):', contestTeamData, contestTeamError);
        
        // 2. 從 contest_team 表查詢 team_id=86
        const { data: contestTeamByTeamId, error: contestTeamByTeamIdError } = await supabase
          .from('contest_team')
          .select('*')
          .eq('team_id', 86);
        
        console.log('📊 contest_team 查詢結果 (team_id=86):', contestTeamByTeamId, contestTeamByTeamIdError);
        
        // 3. 從 courts 表查詢
        const { data: courtsData, error: courtsError } = await supabase
          .from('courts')
          .select('*')
          .eq('team_id', 86);
        
        console.log('🏟️ courts 查詢結果 (team_id=86):', courtsData, courtsError);
        
        // 4. 查詢當前比賽的所有隊伍
        const { data: allContestTeams, error: allContestTeamsError } = await supabase
          .from('contest_team')
          .select('*')
          .eq('contest_id', contestId);
        
        console.log('🎯 當前比賽所有隊伍:', allContestTeams, allContestTeamsError);
        
        setDebugTeam86({
          contestTeamData,
          contestTeamByTeamId,
          courtsData,
          allContestTeams,
          currentTeams: teams,
          contestId
        });
      } catch (err) {
        console.error('Debug 查詢失敗:', err);
        setDebugTeam86({ error: err });
      }
    };
    
    if (contestId) {
      fetchTeam86Debug();
    }
  }, [contestId, teams]);

  // 主要渲染
  return (
    <div className="tournament-bracket-page" style={{ position: 'relative' }}>
      <h1>🏆 標準淘汰賽賽程圖</h1>
      
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
      
      {/* 移除決賽賽制配置對話框（簡化為標準淘汰賽） */}
    </div>
  );
};

export default TournamentBracketPage;