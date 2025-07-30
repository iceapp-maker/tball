import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { finishContest } from './utils/contestFinishAndAdvancement';
import './TournamentBracketPage.css'; // 引入淘汰賽圖表樣式

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

interface ChildContest {
  contest_id: number;
  contest_name: string;
  contest_status: string;
  team_name: string;
  created_by: string;
  parent_contest_id: number;
  advancement_rules?: {
    advancement_count?: number;
    advances?: number;
    advancement_team_count?: number;
  };
  match_mode?: string;
  qualified_teams?: {
    contest_team_id: number;
    team_name: string;
    points?: number;
  }[];
}

interface ExtendedTeamResult extends TeamResult {
  losingGames?: number;
}

const ContestResultsPage: React.FC = () => {
  const { contestId } = useParams<{ contestId: string }>();
  const [contestData, setContestData] = useState<any>(null);
  const [matchResults, setMatchResults] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const location = useLocation();

  // 獲取比賽數據
  const fetchContestData = async () => {
    try {
      setLoading(true);
      setError('');

      // 獲取比賽基本資料
      const { data: contest, error: contestError } = await supabase
        .from('contest')
        .select('*')
        .eq('contest_id', contestId)
        .single();

      if (contestError) throw contestError;
      setContestData(contest);

      // 獲取參賽隊伍
      const { data: teamsData, error: teamsError } = await supabase
        .from('contest_team')
        .select('*')
        .eq('contest_id', contestId);

      if (teamsError) throw teamsError;
      setTeams(teamsData || []);

      // 獲取比賽結果
      const { data: matches, error: matchError } = await supabase
        .from('contest_match')
        .select(`
          *,
          team1:team1_id (team_name),
          team2:team2_id (team_name),
          winner:winner_team_id (team_name),
          contest_match_detail (*)
        `)
        .eq('contest_id', contestId)
        .order('match_id', { ascending: true });

      if (matchError) throw matchError;
      setMatchResults(matches || []);

    } catch (err: any) {
      console.error('獲取比賽數據失敗:', err);
      setError('獲取比賽數據失敗: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (contestId) {
      fetchContestData();
    }
  }, [contestId]);


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
  const [matchMode, setMatchMode] = useState<string>('round_robin'); // 新增：比賽模式，預設為循環賽
  const [bracketData, setBracketData] = useState<any>(null); // 新增：淘汰賽圖表數據
  const [isUpdatingBracket, setIsUpdatingBracket] = useState<boolean>(false); // 新增：是否正在更新淘汰賽圖表
  const [refreshing, setRefreshing] = useState(false); // 新增：是否正在刷新資料
  const [childContests, setChildContests] = useState<ChildContest[]>([]); // 新增：子賽事列表
  const [isParentContest, setIsParentContest] = useState(false); // 新增：是否為主賽事

  // 新增一個函數用於在更新比分後或手動刷新時重新載入資料
  const refreshAfterScoreUpdate = async () => {
    console.log('重新載入比賽資料...');
    await fetchContestResults();
  };
  
  // 新增手動刷新頁面數據的函數
  const handleRefresh = async () => {
    try {
      setRefreshing(true);
      console.log('開始手動刷新比賽結果...');
      
      // 直接調用 fetchContestResults 並等待其完成
      await fetchContestResults();
      console.log('刷新數據完成');
    } catch (error) {
      console.error('刷新數據時出錯:', error);
      setError('刷新數據時出錯，請稍後再試');
    } finally {
      setRefreshing(false);
    }
  };

  // 將此函數暴露給全局，以便其他組件可以調用
  useEffect(() => {
    if (window) {
      (window as any).refreshContestResults = refreshAfterScoreUpdate;
    }
    return () => {
      if (window) {
        delete (window as any).refreshContestResults;
      }
    };
  }, []);

  useEffect(() => {
    if (contestId) {
      checkUserRole();
      fetchContestDetails();
      fetchContestResults();
      fetchChildContests(); // 新增：獲取子賽事
    }
  }, [contestId]);

  // 獲取子賽事列表和晉級隊伍
  const fetchChildContests = async () => {
    try {
      // 獲取子賽事列表，按照 contest_id 排序（產生順序）
      const { data: childContestsData, error: childError } = await supabase
        .from('contest')
        .select('*')
        .eq('parent_contest_id', contestId)
        .order('contest_id', { ascending: true }); // 按產生順序排序

      if (childError) throw childError;

      if (childContestsData && childContestsData.length > 0) {
        setIsParentContest(true);
        
        // 為每個子賽事獲取晉級隊伍信息
        const childContestsWithQualified = childContestsData.map((child) => {
          let qualifiedTeams: any[] = [];
          
          // 如果子賽事已完成，從 advancement_rules 獲取晉級隊伍
          if (child.contest_status === 'finished' && child.advancement_rules?.qualified_teams) {
            qualifiedTeams = child.advancement_rules.qualified_teams;
          }
          
          return {
            ...child,
            qualified_teams: qualifiedTeams
          };
        });
        
        setChildContests(childContestsWithQualified);
      } else {
        setIsParentContest(false);
        setChildContests([]);
      }
    } catch (err) {
      console.error('獲取子賽事失敗:', err);
      setIsParentContest(false);
      setChildContests([]);
    }
  };

  // 獲取晉級隊伍（統一方法）
  const getQualifiedTeams = async (contestId: string) => {
    try {
      // 獲取子賽事的晉級規則
      const { data: contestInfo, error: contestInfoError } = await supabase
        .from('contest')
        .select('advancement_rules')
        .eq('contest_id', contestId)
        .single();

      if (contestInfoError) throw contestInfoError;

      // 直接從 advancement_rules 獲取晉級隊伍
      if (contestInfo.advancement_rules?.qualified_teams) {
        return contestInfo.advancement_rules.qualified_teams;
      }

      return [];
      
    } catch (err) {
      console.error(`獲取子賽事 ${contestId} 晉級隊伍失敗:`, err);
      return [];
    }
  };

  useEffect(() => {
    console.log('matchesData:', matchesData);
    
    // 如果是淘汰賽模式且有比賽數據和圖表數據，檢查是否需要自動更新下一輪
    if (matchMode === 'elimination' && !isContestFinished && bracketData && matchesData.length > 0) {
      checkAndUpdateNextRound(bracketData, matchesData);
    }
  }, [matchesData, bracketData, matchMode, isContestFinished]);

  // 獲取完整比賽資訊的輔助函數
  const getMatchInfo = (teamId: number, otherTeamId: number) => {
    if (!matchesData || matchesData.length === 0) return { matchId: "", position: "", score: "尚無比分" };
    
    // 尋找匹配這兩支隊伍的比賽資料
    const matchData = matchesData.find((m: any) => 
      (m.team1_id === teamId && m.team2_id === otherTeamId) || 
      (m.team1_id === otherTeamId && m.team2_id === teamId)
    );
    
    if (!matchData) return { matchId: "", position: "", score: "尚無比分" };
    
    // 確定這支隊伍是 team1 還是 team2
    const position = matchData.team1_id === teamId ? "team1" : "team2";
    
    return { 
      matchId: matchData.match_id, 
      position, 
      score: matchData.score || "尚無比分" 
    };
  };
  
  // 獲取比賽 match_id 的輔助函數
  const getMatchId = (teamId: number, otherTeamId: number) => {
    const { matchId } = getMatchInfo(teamId, otherTeamId);
    return matchId;
  };

  // 獲取比賽比分的輔助函數
  const getMatchScore = (teamId: number, otherTeamId: number) => {
    // 優先使用新的 matchResults 數據
    if (matchResults && matchResults.length > 0) {
      const match = matchResults.find(m => 
        (m.team1_id === teamId && m.team2_id === otherTeamId) ||
        (m.team1_id === otherTeamId && m.team2_id === teamId)
      );
      
      if (!match || !match.contest_match_detail || match.contest_match_detail.length === 0) {
        return "尚無比分";
      }
      
      // 計算總比分（贏得的局數）
      let team1Score = 0;
      let team2Score = 0;
      
      match.contest_match_detail.forEach((detail: any) => {
        if (detail.winner_team_id) {
          if (detail.winner_team_id === match.team1_id) {
            team1Score++;
          } else if (detail.winner_team_id === match.team2_id) {
            team2Score++;
          }
        }
      });
      
      // 根據查詢的隊伍順序返回比分
      if (match.team1_id === teamId) {
        return `${team1Score}:${team2Score}`;
      } else {
        return `${team2Score}:${team1Score}`;
      }
    }
    
    // 如果沒有新數據，回退到舊的邏輯
    const { score, position } = getMatchInfo(teamId, otherTeamId);
    
    if (!score || score === "尚無比分") return "尚無比分";
    
    // 分析比分字符串，格式為 "A:B"
    const scores = score.split(':');
    if (scores.length !== 2) return "尚無比分";
    
    // 在 contest_match 資料表中，第一支隊伍 (team1) 的得分是 A，第二支隊伍 (team2) 的得分是 B
    if (position === "team1") {
      return scores[0]; // 第一支隊伍 (team1) 得分 A
    } else if (position === "team2") {
      return scores[1]; // 第二支隊伍 (team2) 得分 B
    } else {
      return "尚無比分";
    }
  };
  
  // 注意：我們直接在 JSX 中使用 getMatchInfo().position 獲取隊伍位置

// 檢查所有輪比賽結果並更新下一輪隊伍
const checkAndUpdateNextRound = async (bracketStructure: any, matches: any[]) => {
  if (!bracketStructure || !bracketStructure.rounds || bracketStructure.rounds.length < 2) {
    return;
  }
  
  // 防止重複執行
  if (isUpdatingBracket) {
    return;
  }
  
  setIsUpdatingBracket(true);
  
  try {
    const newBracketData = { ...bracketStructure };
    let hasUpdates = false;
    
    // 遍歷所有輪次（除了最後一輪）
    for (let roundIndex = 0; roundIndex < newBracketData.rounds.length - 1; roundIndex++) {
      const currentRound = newBracketData.rounds[roundIndex];
      const nextRoundIndex = roundIndex + 1;
      
      // 遍歷當前輪次的每場比賽
      for (let matchIndex = 0; matchIndex < currentRound.matches.length; matchIndex++) {
        const match = currentRound.matches[matchIndex];
        
        // 如果沒有設置獲勝者但有兩個隊伍
        if (!match.winnerId && match.team1Id && match.team2Id) {
          // 查找資料庫中的比賽記錄
          const dbMatch = matches.find(
            m => (m.team1_id === match.team1Id && m.team2_id === match.team2Id) || 
                 (m.team1_id === match.team2Id && m.team2_id === match.team1Id)
          );
          
          // 如果找到比賽記錄且有獲勝者
          if (dbMatch && dbMatch.winner_team_id) {
            // 設置當前比賽的獲勝者
            match.winnerId = dbMatch.winner_team_id;
            hasUpdates = true;
            
            // 如果有下一輪比賽，則更新下一輪的隊伍
            if (match.nextMatchPosition) {
              const nextMatchIndex = match.nextMatchPosition - 1;
              
              if (newBracketData.rounds[nextRoundIndex] && 
                  newBracketData.rounds[nextRoundIndex].matches[nextMatchIndex]) {
                const nextMatch = newBracketData.rounds[nextRoundIndex].matches[nextMatchIndex];
                
                if (match.nextMatchTeamSlot === 1) {
                  nextMatch.team1Id = dbMatch.winner_team_id;
                } else {
                  nextMatch.team2Id = dbMatch.winner_team_id;
                }
              }
            }
          }
        }
      }
    }
    
    // 第二次遍歷：檢查並更新所有輪次的獲勝者（包括已經有兩個隊伍的比賽）
    for (let roundIndex = 0; roundIndex < newBracketData.rounds.length; roundIndex++) {
      const currentRound = newBracketData.rounds[roundIndex];
      
      for (let matchIndex = 0; matchIndex < currentRound.matches.length; matchIndex++) {
        const match = currentRound.matches[matchIndex];
        
        // 如果有兩個隊伍但沒有獲勝者，檢查資料庫
        if (match.team1Id && match.team2Id && !match.winnerId) {
          const dbMatch = matches.find(
            m => (m.team1_id === match.team1Id && m.team2_id === match.team2Id) || 
                 (m.team1_id === match.team2Id && m.team2_id === match.team1Id)
          );
          
          if (dbMatch && dbMatch.winner_team_id) {
            match.winnerId = dbMatch.winner_team_id;
            hasUpdates = true;
          }
        }
      }
    }
    
    // 如果有更新，則保存到資料庫
    if (hasUpdates) {
      // 更新 bracketData 狀態
      setBracketData(newBracketData);
      
      // 將更新後的淘汰賽圖表結構保存到資料庫
      const { error } = await supabase
        .from('contest')
        .update({ 
          bracket_structure: newBracketData
        })
        .eq('contest_id', contestId);
      
      if (error) {
        console.error('更新淘汰賽圖表結構失敗:', error);
        throw error;
      }
      
      // 為所有輪次的新比賽創建記錄
      const newMatches = [];
      
      // 遍歷所有輪次（從第二輪開始）
      for (let roundIndex = 1; roundIndex < newBracketData.rounds.length; roundIndex++) {
        const round = newBracketData.rounds[roundIndex];
        
        for (let matchIndex = 0; matchIndex < round.matches.length; matchIndex++) {
          const match = round.matches[matchIndex];
          
          // 只處理有兩個隊伍的比賽
          if (match.team1Id && match.team2Id) {
            // 檢查是否已經存在這場比賽的記錄
            const existingMatch = matches.find(
              m => (m.team1_id === match.team1Id && m.team2_id === match.team2Id) || 
                   (m.team1_id === match.team2Id && m.team2_id === match.team1Id)
            );
            
            if (!existingMatch) {
              // 創建新的比賽記錄
              newMatches.push({
                contest_id: contestId,
                team1_id: match.team1Id,
                team2_id: match.team2Id,
                winner_team_id: null,
                match_date: new Date().toISOString().split('T')[0],
                score: null,
                round: roundIndex + 1, // 輪次從 1 開始
                sequence: matchIndex + 1
              });
            }
          }
        }
      }
      
      // 批量插入新的比賽記錄
      if (newMatches.length > 0) {
        const { data: insertedMatches, error: matchesError } = await supabase
          .from('contest_match')
          .insert(newMatches)
          .select();
        
        if (matchesError) {
          console.error('創建第二輪比賽記錄失敗:', matchesError);
          throw matchesError;
        }
        
        // 獲取比賽設定
        const { data: contestData, error: contestDataError } = await supabase
          .from('contest')
          .select('*')
          .eq('contest_id', contestId)
          .single();
        
        if (contestDataError) {
          console.error('獲取比賽設定失敗:', contestDataError);
          throw contestDataError;
        }
        
        // 確定比賽項目數量和類型
        const totalPoints = contestData.total_points || 3; // 預設為 3 場
        let pointsConfig = [];
        
        try {
          if (contestData.points_config) {
            // 如果是字符串，嘗試解析為 JSON
            if (typeof contestData.points_config === 'string') {
              pointsConfig = JSON.parse(contestData.points_config);
            } else {
              // 已經是物件或陣列
              pointsConfig = contestData.points_config;
            }
            
            // 確保每個項目都有 type 屬性
            pointsConfig = pointsConfig.map((item: any) => {
              if (!item.type) {
                return { ...item, type: '單打' }; // 如果類型無效，預設為單打
              }
              // 確保使用中文的單雙打格式
              if (item.type === 'singles') {
                return { ...item, type: '單打' };
              } else if (item.type === 'doubles') {
                return { ...item, type: '雙打' };
              }
              return item;
            });
          }
        } catch (e) {
          console.error('解析 points_config 失敗:', e);
          // 如果解析失敗，使用預設值（使用中文格式）
          pointsConfig = [
            { type: '雙打', points: 1 },
            { type: '雙打', points: 1 },
            { type: '單打', points: 1 }
          ];
        }
        
        // 為每場新比賽創建詳細記錄
        for (const match of insertedMatches || []) {
          // 從 match 中獲取輪次信息，確保有值
          const matchRound = match.round || 0;
          
          console.log('創建比賽詳情，比賽ID:', match.match_id, '輪次:', matchRound);
          
          for (let i = 0; i < totalPoints; i++) {
            // 確定比賽類型
            let matchType = '單打'; // 預設為單打（中文格式）
            
            if (pointsConfig && pointsConfig.length > 0) {
              // 如果 i 超出了 pointsConfig 的範圍，則使用最後一個配置
              const configIndex = i < pointsConfig.length ? i : pointsConfig.length - 1;
              matchType = pointsConfig[configIndex].type || '單打';
            } else {
              // 如果沒有配置，使用預設規則：前兩場雙打，後面單打（中文格式）
              matchType = i < 2 ? '雙打' : '單打';
            }
            
            // 確保 bracket_round 有值（不能為 null）
            // 如果 matchRound 為 0，則使用預設值 1（第一輪）
            const bracketRound = matchRound > 0 ? matchRound : 1;
            
            // 從資料庫結構中確認欄位名稱
            const matchDetail = {
              match_id: match.match_id,
              contest_id: contestId,
              team1_member_ids: [],
              team2_member_ids: [],
              winner_team_id: null,
              score: null,
              sequence: i + 1,
              match_type: matchType,
              table_no: null,
              judge_id: null,
              bracket_round: bracketRound // 使用確保有值的 bracketRound
            };
            
            console.log('插入比賽詳情:', matchDetail);
            
            try {
              // 先插入基本資料
              const { data: insertedDetail, error: detailError } = await supabase
                .from('contest_match_detail')
                .insert([matchDetail])
                .select();
              
              if (detailError) {
                console.error('新增比賽詳情失敗:', detailError, matchDetail);
              } else {
                console.log('成功插入比賽詳情:', insertedDetail);
                
                // 如果插入成功，再獨立更新 bracket_round 欄位
                if (insertedDetail && insertedDetail.length > 0) {
                  const detailId = insertedDetail[0].match_detail_id;
                  
                  // 嘗試使用標準更新，確保傳入數字類型
                  console.log('嘗試更新 match_detail_id:', detailId, '的 bracket_round 為:', bracketRound, '類型:', typeof bracketRound);
                  
                  // 確保傳入的是數字類型
                  const numericRound = Number(bracketRound);
                  
                  const { data: updateData, error: updateError } = await supabase
                    .from('contest_match_detail')
                    .update({ bracket_round: numericRound })
                    .eq('match_detail_id', detailId)
                    .select();
                  
                  if (updateError) {
                    console.error('更新 bracket_round 失敗:', updateError);
                  } else {
                    console.log('成功更新 bracket_round，更新後的資料:', updateData);
                    
                    // 再次查詢確認更新結果
                    const { data: checkData } = await supabase
                      .from('contest_match_detail')
                      .select('match_detail_id, bracket_round')
                      .eq('match_detail_id', detailId);
                    
                    console.log('更新後再次查詢:', checkData);
                  }
                }
              }
            } catch (err) {
              console.error('處理比賽詳情插入時發生錯誤:', err);
            }
          }
        }
        
        // 重新載入比賽資料
        fetchContestResults();
      }
    }
  } catch (error: any) {
    console.error('更新淘汰賽圖表失敗:', error);
  } finally {
    setIsUpdatingBracket(false);
  }
};

  const checkUserRole = async () => {
    try {
      const storedUser = JSON.parse(localStorage.getItem('loginUser') || '{}');
      const isUserAdmin = storedUser.role === 'admin' || storedUser.is_admin === true;
      setIsAdmin(isUserAdmin);
    } catch (err) {
      console.error('檢查用戶角色時出錯:', err);
    }
  };

  // 處理多組競賽主賽事的結果顯示
  const fetchLeagueResults = async (parentContest: any, childContests: any[]) => {
    try {
      setContestName(parentContest.contest_name);
      setIsContestFinished(parentContest.contest_status === 'finished');
      setMatchMode('league'); // 設置為聯賽模式
      
      // 分離分組賽和決賽
      const groupStages = childContests.filter(c => c.contest_type === 'group_stage');
      const playoff = childContests.find(c => c.contest_type === 'playoff_stage');
      
      console.log('分組賽事:', groupStages.length, '個');
      console.log('決賽賽事:', playoff ? '存在' : '不存在');
      
      // 獲取各分組的冠軍隊伍
      const groupResults = await Promise.all(groupStages.map(async (group) => {
        // 獲取分組名稱和狀態
        const groupInfo = {
          contest_id: group.contest_id,
          contest_name: group.contest_name,
          contest_status: group.contest_status
        };
        
        // 獲取分組的隊伍
        const { data: groupAssignments } = await supabase
          .from('contest_group_assignment')
          .select('contest_team_id')
          .eq('group_contest_id', group.contest_id);
        
        if (groupAssignments && groupAssignments.length > 0) {
          const teamIds = groupAssignments.map(ga => ga.contest_team_id);
          
          // 獲取隊伍資訊
          const { data: teams } = await supabase
            .from('contest_team')
            .select('contest_team_id, team_name')
            .in('contest_team_id', teamIds);
          
          // 獲取分組的最後獲勝隊伍
          const { data: matchData } = await supabase
            .from('contest_match')
            .select('winner_team_id')
            .eq('contest_id', group.contest_id)
            .not('winner_team_id', 'is', null)
            .order('created_at', { ascending: false })
            .limit(1);
          
          let champion = null;
          if (matchData && matchData.length > 0 && teams) {
            const winnerTeam = teams.find(t => t.contest_team_id === matchData[0].winner_team_id);
            if (winnerTeam) {
              champion = {
                team_id: winnerTeam.contest_team_id,
                team_name: winnerTeam.team_name
              };
            }
          }
          
          return {
            ...groupInfo,
            teams: teams || [],
            champion
          };
        }
        
        return {
          ...groupInfo,
          teams: [],
          champion: null
        };
      }));
      
      // 獲取決賽結果
      let playoffResult = null;
      if (playoff) {
        // 獲取決賽的比賽結果
        const { data: playoffMatches } = await supabase
          .from('contest_match')
          .select('*')
          .eq('contest_id', playoff.contest_id)
          .order('created_at', { ascending: false });
        
        // 獲取決賽隊伍
        const { data: playoffTeams } = await supabase
          .from('contest_team')
          .select('*')
          .eq('contest_id', playoff.contest_id);
        
        playoffResult = {
          contest_id: playoff.contest_id,
          contest_name: playoff.contest_name,
          contest_status: playoff.contest_status,
          teams: playoffTeams || [],
          matches: playoffMatches || []
        };
      }
      
      // 設置聯賽結果數據
      const leagueData = {
        parentContest,
        groupResults,
        playoffResult,
        isLeague: true
      };
      
      // 將聯賽數據存儲到 resultsData 中以便在 JSX 中使用
      setResultsData({
        teams: [],
        teamIdToIndex: {},
        leagueData
      } as any);
      
    } catch (err) {
      console.error('獲取聯賽結果失敗:', err);
      setError('無法載入聯賽結果，請稍後再試');
    } finally {
      setLoading(false);
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
  const checkIncompleteMatches = (teams: TeamResult[], maxSeq: number): boolean => {
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
    // 優先使用當前頁面已有的比賽結果數據（與比分表顯示一致）
    if (resultsData && resultsData.teams && resultsData.teams.length > 0) {
      // 使用與比分表完全相同的排序結果，取前N名晉級隊伍
      const qualifiedTeams = resultsData.teams
        .slice(0, advancementCount)
        .map(team => ({ contest_team_id: team.teamId }));

      console.log('從當前結果數據獲取的晉級隊伍（與比分表排序一致）:', qualifiedTeams);
      console.log('比分表排序:', resultsData.teams.map(t => `${t.rank}. ${t.teamName} (${t.wins}勝)`));
      return qualifiedTeams;
    }

    // 如果沒有當前結果數據，則重新計算
    const { data: matches, error: matchError } = await supabase
      .from('contest_match')
      .select('match_id, team1_id, team2_id, winner_team_id')
      .eq('contest_id', contestId);

    if (matchError) throw matchError;

    // 先獲取該子賽事的所有參賽隊伍
    const { data: assignments, error: assignmentError } = await supabase
      .from('contest_group_assignment')
      .select('contest_team_id')
      .eq('group_contest_id', contestId);

    if (assignmentError) throw assignmentError;

    // 獲取比賽詳情（每局勝負）
    const matchIds = matches?.map(match => match.match_id) || [];
    const { data: matchDetails, error: detailError } = await supabase
      .from('contest_match_detail')
      .select('match_id, winner_team_id')
      .in('match_id', matchIds);

    if (detailError) throw detailError;

    // 計算隊伍排名（使用與比分表相同的邏輯）
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

    // 排序隊伍（使用與比分表完全相同的排序邏輯）
    const teamsArray = Object.values(teamResults);
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
        
        // 🔧 使用與比分表顯示完全相同的排序邏輯
        const sortedGroup = sortTeamsByHeadToHead(teamsWithSameWins);
        sortedTeams.push(...sortedGroup);
      });

    // 取前N名晉級隊伍，確保數量嚴格符合晉級數
    const qualifiedTeams = sortedTeams
      .slice(0, advancementCount)
      .map(team => ({ contest_team_id: team.teamId }));

    console.log(`排序後的晉級隊伍 (應為${advancementCount}支):`, qualifiedTeams);
    
    // 再次確認數量正確
    if (qualifiedTeams.length !== advancementCount) {
      console.warn(`晉級隊伍數量不符: 期望${advancementCount}支，實際${qualifiedTeams.length}支`);
    }
    
    return qualifiedTeams;
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

    const qualifiedTeams = finalWinners.slice(0, advancementCount).map(teamId => ({ contest_team_id: teamId }));
    
    console.log(`淘汰賽晉級隊伍 (應為${advancementCount}支):`, qualifiedTeams);
    
    // 確認數量正確
    if (qualifiedTeams.length !== advancementCount) {
      console.warn(`淘汰賽晉級隊伍數量不符: 期望${advancementCount}支，實際${qualifiedTeams.length}支`);
    }
    
    return qualifiedTeams;
  };

  const handleFinishContest = async () => {
    if (!isAdmin || !allScoresFilled || hasIncompleteMatches) return;
    
    try {
      setUpdating(true);
      
      // 使用共用函數處理結束賽事邏輯
      const success = await finishContest(contestId!);

      if (success) {
        setIsContestFinished(true);
        alert('比賽已成功結束！');
        
        // 重新載入頁面資料以確保同步
        await fetchContestResults();
      } else {
        throw new Error('結束賽事失敗');
      }
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
      // 检查是否为联赛模式（有子赛事）
      let allMatches: any[] = [];
      
      if (matchMode === 'league' && (resultsData as any).leagueData) {
        console.log('联赛模式：获取所有子赛事的比赛记录');
        
        // 获取所有子赛事的比赛记录
        const groupResults = (resultsData as any).leagueData.groupResults || [];
        const playoffResult = (resultsData as any).leagueData.playoffResult;
        
        // 收集所有子赛事的contest_id
        const childContestIds = [];
        groupResults.forEach((group: any) => {
          if (group.contest_id) {
            childContestIds.push(group.contest_id);
          }
        });
        
        if (playoffResult && playoffResult.contest_id) {
          childContestIds.push(playoffResult.contest_id);
        }
        
        console.log('子赛事IDs:', childContestIds);
        
        if (childContestIds.length > 0) {
          // 获取所有子赛事的比赛记录
          const { data: childMatches, error: childMatchesError } = await supabase
            .from('contest_match')
            .select('match_id, team1_id, team2_id, contest_id')
            .in('contest_id', childContestIds);
          
          if (childMatchesError) throw childMatchesError;
          allMatches = childMatches || [];
          console.log('从子赛事获取到的比赛记录数:', allMatches.length);
        }
      } else {
        // 非联赛模式：获取当前比赛的比赛记录
        const { data: matches, error: matchesError } = await supabase
          .from('contest_match')
          .select('match_id, team1_id, team2_id')
          .eq('contest_id', contestId);

        if (matchesError) throw matchesError;
        allMatches = matches || [];
        console.log('从当前比赛获取到的比赛记录数:', allMatches.length);
      }

      if (allMatches.length === 0) {
        console.log('没有找到比赛记录');
        setDetailedMatches([]);
        return;
      }

      // 获取所有比赛的详细记录
      const matchIds = allMatches.map(m => m.match_id);
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
        .in('match_id', matchIds);

      if (detailsError) throw detailsError;

      // 获取所有参与的队伍ID
      const teamIds = Array.from(new Set(
        allMatches.flatMap(match => [match.team1_id, match.team2_id]).filter(Boolean)
      ));

      if (teamIds.length === 0) {
        console.log('没有找到参与的队伍');
        setDetailedMatches([]);
        return;
      }

      // 对于联赛模式，需要从所有相关的contest中获取队伍信息
      let allTeams: any[] = [];
      if (matchMode === 'league' && (resultsData as any).leagueData) {
        console.log('联赛模式：获取队伍信息');
        
        // 方法1：直接从leagueData中获取队伍信息
        const groupResults = (resultsData as any).leagueData.groupResults || [];
        const playoffResult = (resultsData as any).leagueData.playoffResult;
        
        // 从分组赛结果中收集队伍信息
        groupResults.forEach((group: any) => {
          if (group.teams && Array.isArray(group.teams)) {
            group.teams.forEach((team: any) => {
              if (team.contest_team_id && team.team_name) {
                allTeams.push({
                  contest_team_id: team.contest_team_id,
                  team_name: team.team_name,
                  contest_id: group.contest_id
                });
              }
            });
          }
        });
        
        // 从决赛结果中收集队伍信息
        if (playoffResult && playoffResult.teams && Array.isArray(playoffResult.teams)) {
          playoffResult.teams.forEach((team: any) => {
            if (team.contest_team_id && team.team_name) {
              // 检查是否已存在，避免重复
              const exists = allTeams.some(t => t.contest_team_id === team.contest_team_id);
              if (!exists) {
                allTeams.push({
                  contest_team_id: team.contest_team_id,
                  team_name: team.team_name,
                  contest_id: playoffResult.contest_id
                });
              }
            }
          });
        }
        
        console.log('从leagueData获取的队伍信息:', allTeams);
        
        // 方法2：如果上面没有获取到足够的队伍信息，则从数据库查询
        if (allTeams.length === 0) {
          console.log('从leagueData未获取到队伍信息，尝试从数据库查询');
          
          const childContestIds = [];
          groupResults.forEach((group: any) => {
            if (group.contest_id) {
              childContestIds.push(group.contest_id);
            }
          });
          
          if (playoffResult && playoffResult.contest_id) {
            childContestIds.push(playoffResult.contest_id);
          }
          
          if (childContestIds.length > 0) {
            const { data: childTeams, error: childTeamsError } = await supabase
              .from('contest_team')
              .select('contest_team_id, team_name, contest_id')
              .in('contest_id', childContestIds);
            
            if (childTeamsError) throw childTeamsError;
            allTeams = childTeams || [];
            console.log('从数据库获取的队伍信息:', allTeams);
          }
        }
        
        // 方法3：如果还是没有，尝试直接用teamIds查询
        if (allTeams.length === 0 && teamIds.length > 0) {
          console.log('尝试直接用teamIds查询队伍信息');
          const { data: directTeams, error: directTeamsError } = await supabase
            .from('contest_team')
            .select('contest_team_id, team_name')
            .in('contest_team_id', teamIds);
          
          if (!directTeamsError && directTeams) {
            allTeams = directTeams;
            console.log('直接查询获取的队伍信息:', allTeams);
          }
        }
      } else {
        // 非联赛模式：获取当前比赛的队伍信息
        const { data: teams, error: teamsError } = await supabase
          .from('contest_team')
          .select('contest_team_id, team_name')
          .in('contest_team_id', teamIds);

        if (teamsError) throw teamsError;
        allTeams = teams || [];
      }

      // 获取队员信息
      const { data: members, error: membersError } = await supabase
        .from('contest_team_member')
        .select('contest_team_id, member_id, member_name')
        .in('contest_team_id', teamIds);

      if (membersError) throw membersError;

      console.log('获取到的数据:', {
        matches: allMatches.length,
        matchDetails: matchDetails?.length || 0,
        teams: allTeams?.length || 0,
        members: members?.length || 0
      });

      const processedMatches = processDetailedMatches(matchDetails || [], allMatches || [], allTeams || [], members || []);
      setDetailedMatches(processedMatches);
      setMatchesData(allMatches || []);
      
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
    console.log('处理详细比赛数据:', {
      details: details.length,
      matches: matches.length,
      teams: teams.length,
      members: members.length
    });

    if (details.length === 0) {
      console.log('没有详细比赛数据');
      return [];
    }

    const teamMap = new Map(teams.map(team => [team.contest_team_id, team.team_name]));
    const memberMap = new Map(members.map(member => [member.member_id, member.member_name]));
    
    console.log('成员映射表示例:', Array.from(memberMap.entries()).slice(0, 5));
    
    const matchGroups = new Map<number, any[]>();
    details.forEach(detail => {
      if (!matchGroups.has(detail.match_id)) {
        matchGroups.set(detail.match_id, []);
      }
      matchGroups.get(detail.match_id)?.push(detail);
    });

    console.log('按比赛分组的详细数据:', Array.from(matchGroups.keys()));

    const result: DetailedMatch[] = [];
    
    matchGroups.forEach((matchDetails, matchId) => {
      const match = matches.find(m => m.match_id === matchId);
      if (!match) {
        console.log(`找不到比赛ID ${matchId} 的基本信息`);
        return;
      }

      const team1Name = teamMap.get(match.team1_id) || '未知隊伍';
      const team2Name = teamMap.get(match.team2_id) || '未知隊伍';

      console.log(`处理比赛 ${matchId}: ${team1Name} vs ${team2Name}, 详细记录数: ${matchDetails.length}`);

      const processedDetails = matchDetails
        .sort((a, b) => a.sequence - b.sequence)
        .map(detail => {
          console.log('处理详细记录:', {
            sequence: detail.sequence,
            team1_member_ids: detail.team1_member_ids,
            team2_member_ids: detail.team2_member_ids,
            winner_team_id: detail.winner_team_id
          });

          // 处理 team1_member_ids，可能是字符串或数组
          let team1MemberIds = [];
          if (detail.team1_member_ids) {
            if (typeof detail.team1_member_ids === 'string') {
              try {
                team1MemberIds = JSON.parse(detail.team1_member_ids);
              } catch (e) {
                console.error('解析 team1_member_ids 失败:', detail.team1_member_ids);
                team1MemberIds = [];
              }
            } else if (Array.isArray(detail.team1_member_ids)) {
              team1MemberIds = detail.team1_member_ids;
            }
          }

          // 处理 team2_member_ids，可能是字符串或数组
          let team2MemberIds = [];
          if (detail.team2_member_ids) {
            if (typeof detail.team2_member_ids === 'string') {
              try {
                team2MemberIds = JSON.parse(detail.team2_member_ids);
              } catch (e) {
                console.error('解析 team2_member_ids 失败:', detail.team2_member_ids);
                team2MemberIds = [];
              }
            } else if (Array.isArray(detail.team2_member_ids)) {
              team2MemberIds = detail.team2_member_ids;
            }
          }

          const team1Members = team1MemberIds.map((id: string) => {
            const memberName = memberMap.get(id) || `未知選手(${id})`;
            console.log(`队伍1成员ID ${id} -> ${memberName}`);
            return memberName;
          });

          const team2Members = team2MemberIds.map((id: string) => {
            const memberName = memberMap.get(id) || `未知選手(${id})`;
            console.log(`队伍2成员ID ${id} -> ${memberName}`);
            return memberName;
          });

          console.log('处理后的成员名单:', {
            team1Members,
            team2Members
          });

          return {
            team1Members,
            team2Members,
            winnerTeamId: detail.winner_team_id,
            sequence: detail.sequence,
            score: detail.score
          };
        });

      if (processedDetails.length > 0) {
        result.push({
          matchId,
          team1Name,
          team2Name,
          details: processedDetails
        });
        console.log(`添加比赛 ${matchId} 到结果中，详细记录数: ${processedDetails.length}`);
      }
    });

    console.log(`最终处理结果: ${result.length} 场比赛`);
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

  // 同步 bracket_structure 與資料庫中的比賽記錄
  const syncBracketDataWithMatches = (bracketData: any, matchesData: any[]) => {
    if (!bracketData || !bracketData.rounds || !matchesData || matchesData.length === 0) {
      return bracketData;
    }
    
    console.log('開始同步 bracket_structure 與資料庫中的比賽記錄');
    const newBracketData = JSON.parse(JSON.stringify(bracketData)); // 深度複製
    
    // 按輪次分組比賽
    const matchesByRound = matchesData.reduce((acc: any, match: any) => {
      const round = match.round || 1;
      if (!acc[round]) acc[round] = [];
      acc[round].push(match);
      return acc;
    }, {});
    
    console.log('按輪次分組的比賽:', matchesByRound);
    
    // 更新每一輪的比賽資料
    Object.keys(matchesByRound).forEach(roundKey => {
      const roundIndex = Number(roundKey) - 1;
      
      // 如果 bracket_structure 中沒有這一輪，無法更新
      if (roundIndex >= newBracketData.rounds.length) {
        console.warn(`bracket_structure 中沒有第 ${roundKey} 輪的資料，無法更新`);
        return;
      }
      
      const roundMatches = matchesByRound[roundKey];
      const bracketRound = newBracketData.rounds[roundIndex];
      
      // 更新這一輪的每場比賽
      for (let i = 0; i < Math.min(roundMatches.length, bracketRound.matches.length); i++) {
        const match = roundMatches[i];
        const bracketMatch = bracketRound.matches[i];
        
        // 更新隊伍資訊
        if (match.team1_id) bracketMatch.team1Id = match.team1_id;
        if (match.team2_id) bracketMatch.team2Id = match.team2_id;
        
        // 更新獲勝者資訊
        if (match.winner_team_id) {
          bracketMatch.winnerId = match.winner_team_id;
          
          // 如果有下一輪，同時更新下一輪的隊伍資訊
          if (bracketMatch.nextMatchPosition && roundIndex < newBracketData.rounds.length - 1) {
            const nextRoundIndex = roundIndex + 1;
            const nextMatchIndex = bracketMatch.nextMatchPosition - 1;
            
            if (nextMatchIndex >= 0 && nextMatchIndex < newBracketData.rounds[nextRoundIndex].matches.length) {
              const nextMatch = newBracketData.rounds[nextRoundIndex].matches[nextMatchIndex];
              
              if (bracketMatch.nextMatchTeamSlot === 1) {
                nextMatch.team1Id = match.winner_team_id;
              } else {
                nextMatch.team2Id = match.winner_team_id;
              }
            }
          }
        }
      }
    });
    
    console.log('同步後的 bracket_structure:', newBracketData);
    return newBracketData;
  };



  const fetchContestResults = async () => {
    setLoading(true);
    setError('');
    console.log('開始獲取最新比賽結果數據... 時間戳:', new Date().toISOString());
    
    try {
      // 1. 獲取比賽資料，包括比賽模式和淘汰賽圖表結構
      const { data: contestData, error: contestError } = await supabase
        .from('contest')
        .select('*')
        .eq('contest_id', contestId)
        .single();
      
      if (contestError) throw contestError;
      if (!contestData) {
        setError('沒有找到比賽數據');
        setLoading(false);
        return;
      }

      // 檢查是否為多組競賽主賽事
      const { data: childContests, error: childError } = await supabase
        .from('contest')
        .select('*')
        .eq('parent_contest_id', contestId);

      if (childError) {
        console.error('檢查子賽事時出錯:', childError);
      }

      // 如果有子賽事，說明這是多組競賽主賽事
      if (childContests && childContests.length > 0) {
        console.log('檢測到多組競賽主賽事，載入聯賽結果');
        await fetchLeagueResults(contestData, childContests);
        return;
      }
      
      // 設置比賽名稱、狀態和比賽模式
      setContestName(contestData.contest_name);
      setIsContestFinished(contestData.contest_status === 'finished');
      
      // 修正比賽模式判斷邏輯：只要包含 elimination 字眼的都視為淘汰賽制
      const matchModeValue = contestData.match_mode || 'round_robin';
      const isElimMode = matchModeValue.includes('elimination');
      setMatchMode(isElimMode ? 'elimination' : 'round_robin');
      
      // 2. 獲取比賽記錄
      const { data: matchData, error: matchError } = await supabase
        .from('contest_match')
        .select('match_id, contest_id, team1_id, team2_id, score, winner_team_id, round, sequence, match_date')
        .eq('contest_id', contestId)
        .order('round', { ascending: true });
      
      console.log('收到比賽數據:', matchData);
      
      // 3. 如果是淘汰賽模式，獲取並同步淘汰賽圖表數據
      // 已在上方定義了 isElimMode，這裡直接使用
      if (isElimMode) {
        let updatedBracketData;
        
        // 直接從比賽數據建立淘汰賽圖表，先不管現有的結構
        if (matchData && matchData.length > 0) {
          // 透過輪次分組比賽
          const matchesByRound = matchData.reduce((acc: any, match: any) => {
            const round = match.round || 1;
            if (!acc[round]) acc[round] = [];
            acc[round].push(match);
            return acc;
          }, {});
          
          console.log('按輪次分組的比賽:', matchesByRound);
          
          // 找出比賽的最大輪次
          const roundNumbers = Object.keys(matchesByRound).map(Number);
          const maxRound = Math.max(...roundNumbers);
          console.log('最大輪次:', maxRound);
          
          // 先獲取所有參與比賽的隊伍信息
          const allTeamIds = Array.from(new Set(
            matchData.flatMap(match => [match.team1_id, match.team2_id]).filter(Boolean)
          ));
          
          const { data: allTeamData, error: allTeamError } = await supabase
            .from('contest_team')
            .select('contest_team_id, team_name')
            .in('contest_team_id', allTeamIds);
          
          if (allTeamError) {
            console.error('獲取隊伍資料失敗:', allTeamError);
          }
          
          // 建立隊伍ID到名稱的映射
          const teamIdToNameMap = new Map();
          if (allTeamData) {
            allTeamData.forEach(team => {
              teamIdToNameMap.set(team.contest_team_id, team.team_name);
            });
          }
          
          // 建立新的圖表結構
          updatedBracketData = {
            rounds: [] as any[],
            teamNames: teamIdToNameMap // 保存隊伍名稱映射
          };
          
          // 為每一輪建立比賽結構
          for (let i = 1; i <= maxRound; i++) {
            const roundMatches = matchesByRound[i] || [];
            roundMatches.sort((a: any, b: any) => (a.sequence || 0) - (b.sequence || 0)); // 按照序列排序
            
            const matches = roundMatches.map((match: any) => {
              return {
                team1Id: match.team1_id,
                team2Id: match.team2_id,
                winnerId: match.winner_team_id,
                sequence: match.sequence || 0,
                score: match.score || '',
                matchId: match.match_id, // 保存原始比賽 ID以便查詢比分
                team1Name: teamIdToNameMap.get(match.team1_id) || `隊伍 ${match.team1_id}`,
                team2Name: teamIdToNameMap.get(match.team2_id) || `隊伍 ${match.team2_id}`
              };
            });
            
            updatedBracketData.rounds.push({
              roundNumber: i,
              matches: matches
            });
          }
          
          console.log('重新建立的淘汰賽圖表結構:', updatedBracketData);
        }
        // 如果沒有比賽數據但有現有的圖表結構，則使用現有的
        else if (contestData.bracket_structure && typeof contestData.bracket_structure === 'object') {
          console.log('沒有比賽數據，使用現有淘汰賽圖表數據:', contestData.bracket_structure);
          updatedBracketData = contestData.bracket_structure;
        }
        
        // 設置更新後的圖表數據
        setBracketData(updatedBracketData);
        console.log('設置淘汰賽圖表數據:', updatedBracketData);
      }

      if (matchError) throw matchError;
      
      // 保存比賽數據到 matchesData 狀態中
      setMatchesData(matchData || []);
      
      if (!matchData || matchData.length === 0) {
        if (contestData.match_mode !== 'elimination') {
          setError('沒有找到比賽數據');
        }
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
        .in('match_id', matchData.map((match: any) => match.match_id));
        
      console.log('收到比賽詳情數據:', detailData);
        
      if (detailError) throw detailError;

      // 先獲取最大sequence值
      const maxSeq = await getMaxSequenceValue();
      setMaxSequence(maxSeq);

      const resultsTableData = processMatchResults(matchData, teamData, detailData);
      setResultsData(resultsTableData);
      setAllScoresFilled(checkAllScoresFilled(matchData));
      
      // 保存比賽數據到狀態中
      setMatchesData(matchData || []);
      
      // 直接檢查未完成比賽
      const incomplete = checkIncompleteMatches(resultsTableData.teams, maxSeq);
      setHasIncompleteMatches(incomplete);
      
      console.log('完成獲取和同步最新比賽結果數據');
      setError(''); // 清除任何先前的錯誤
      
    } catch (err: any) {
      console.error('獲取比賽結果錯誤:', err);
      setError(err.message);
    } finally {
      setLoading(false);
      console.log('完成獲取最新比賽結果數據。');
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

  // 判斷比賽是否未完成
  const isMatchIncomplete = (team1Id: string, team2Id: string) => {
    if (!team1Id || !team2Id) return false;
    
    try {
      const scoreString = getMatchScore(team1Id, team2Id);
      if (!scoreString || scoreString === '0:0') return true;
      
      // 檢查如果兩隊已經比賽但分數還未達到結束條件
      const [scoreA, scoreB] = scoreString.split(':').map(Number);
      if (isNaN(scoreA) || isNaN(scoreB)) {
        return false;
      }
      
      return (scoreA + scoreB) < maxSequence;
    } catch (err) {
      console.error('檢查比賽是否完成時出錯:', err);
      return false;
    }
  };
  
  // 補充 TeamResult 類型定義中缺少的屬性
  type ExtendedTeamResult = TeamResult & {
    winCount?: number;
    loseCount?: number;
    losingGames?: number;
  };

  // 尋找最終排名的隊伍
  const findFinalRanking = (rank: number): ExtendedTeamResult | undefined => {
    
    // 如果沒有bracketData或者沒有rounds或者rounds長度為0，則返回undefined
    if (!bracketData || !bracketData.rounds || !Array.isArray(bracketData.rounds) || bracketData.rounds.length === 0) {
      return undefined;
    }
    
    try {
      // 首先確認我們有隊伍資料
      if (!resultsData || !resultsData.teams || !Array.isArray(resultsData.teams) || resultsData.teams.length === 0) {
        console.log('沒有隊伍資料可用來計算排名');
        return undefined;
      }
      
      // 決賽應該在最後一輪
      const finalRound = bracketData.rounds[bracketData.rounds.length - 1];
      if (!finalRound || !finalRound.matches || finalRound.matches.length === 0) {
        return undefined;
      }
      
      // 找到決賽結果
      const finalMatches = finalRound.matches.filter(match => match.winnerId !== null);
      
      // 如果有決賽結果
      if (finalMatches.length > 0) {
        // 找到冠軍賽（通常是最後一場）
        const championshipMatch = finalMatches[0];
        
        // 第1名：決賽勝者
        if (rank === 1 && championshipMatch.winnerId) {
          const champion = resultsData.teams.find((t: TeamResult) => t.teamId === championshipMatch.winnerId);
          if (champion) {
            console.log(`冠軍: ${champion.teamName}`);
            return champion as ExtendedTeamResult;
          }
        }
        
        // 第2名：決賽敗者
        if (rank === 2) {
          if (!championshipMatch.winnerId || !championshipMatch.team1Id || !championshipMatch.team2Id) return undefined;
          
          const secondPlaceTeamId = championshipMatch.team1Id === championshipMatch.winnerId ? 
              championshipMatch.team2Id : championshipMatch.team1Id;
          
          const runnerUp = resultsData.teams.find((t: TeamResult) => t.teamId === secondPlaceTeamId);
          if (runnerUp) {
            console.log(`亞軍: ${runnerUp.teamName}`);
            return runnerUp as ExtendedTeamResult;
          }
        }
        
        // 第3名和第4名：半決賽敗者
        if (rank === 3 || rank === 4) {
          // 找到半決賽輪次（倒數第二輪）
          if (bracketData.rounds.length >= 2) {
            const semiRound = bracketData.rounds[bracketData.rounds.length - 2];
            if (semiRound && semiRound.matches) {
              const semiLosers: number[] = [];
              
              // 收集半決賽的敗者
              semiRound.matches.forEach(match => {
                if (match.winnerId && match.team1Id && match.team2Id) {
                  const loserId = match.team1Id === match.winnerId ? match.team2Id : match.team1Id;
                  semiLosers.push(loserId);
                }
              });
              
              console.log('半決賽敗者ID列表:', semiLosers);
              
              // 如果有兩個半決賽敗者，需要確定季軍和第四名
              if (semiLosers.length >= 2) {
                // 檢查是否有3-4名決定賽
                let thirdPlaceWinnerId: number | null = null;
                let fourthPlaceId: number | null = null;
                
                // 在決賽輪次中尋找3-4名決定賽（通常是position 2的比賽）
                const finalRound = bracketData.rounds[bracketData.rounds.length - 1];
                if (finalRound && finalRound.matches) {
                  const thirdPlaceMatch = finalRound.matches.find(match => 
                    match.position === 2 || 
                    (match.team1Id && match.team2Id && 
                     semiLosers.includes(match.team1Id) && semiLosers.includes(match.team2Id))
                  );
                  
                  if (thirdPlaceMatch && thirdPlaceMatch.winnerId) {
                    thirdPlaceWinnerId = thirdPlaceMatch.winnerId;
                    fourthPlaceId = thirdPlaceMatch.team1Id === thirdPlaceWinnerId ? 
                                   thirdPlaceMatch.team2Id : thirdPlaceMatch.team1Id;
                    console.log('找到3-4名決定賽結果:', { thirdPlaceWinnerId, fourthPlaceId });
                  }
                }
                
                // 如果沒有3-4名決定賽，則按半決賽敗者的順序或其他邏輯排序
                if (!thirdPlaceWinnerId && semiLosers.length >= 2) {
                  // 可以根據半決賽的比分或其他邏輯來決定季軍和第四名
                  // 這裡暫時按照ID順序，實際應用中可能需要更複雜的邏輯
                  thirdPlaceWinnerId = semiLosers[0];
                  fourthPlaceId = semiLosers[1];
                  console.log('沒有3-4名決定賽，按默認順序:', { thirdPlaceWinnerId, fourthPlaceId });
                }
                
                // 返回對應排名的隊伍
                if (rank === 3 && thirdPlaceWinnerId) {
                  const thirdPlace = resultsData.teams.find((t: TeamResult) => t.teamId === thirdPlaceWinnerId);
                  if (thirdPlace) {
                    console.log(`季軍: ${thirdPlace.teamName}`);
                    return thirdPlace as ExtendedTeamResult;
                  }
                }
                
                if (rank === 4 && fourthPlaceId) {
                  const fourthPlace = resultsData.teams.find((t: TeamResult) => t.teamId === fourthPlaceId);
                  if (fourthPlace) {
                    console.log(`第四名: ${fourthPlace.teamName}`);
                    return fourthPlace as ExtendedTeamResult;
                  }
                }
              }
            }
          }
        }
      }
      
      return undefined;
    } catch (err) {
      console.error('尋找最終排名時出錯:', err);
      return undefined;
    }
  };
  
  // 渲染最終排名卡片
  const renderFinalRankingCard = (title: string, team: ExtendedTeamResult | undefined, color: string) => {
    return (
      <div style={{
        width: '200px',
        padding: '15px',
        backgroundColor: 'white',
        borderRadius: '8px',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
        border: `2px solid ${color}`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center'
      }}>
        <div style={{
          fontWeight: 'bold',
          fontSize: '1.1rem',
          marginBottom: '10px',
          color: color
        }}>
          {title}
        </div>
        {team ? (
          <>
            <div style={{ 
              fontWeight: 'bold', 
              fontSize: '1.2rem',
              marginTop: '5px'
            }}>
              {team.teamName}
            </div>
            <div style={{ 
              marginTop: '5px',
              color: '#666',
              fontSize: '0.9rem'
            }}>
              勝場：{team.winningGames || 0} | 負場：{team.losingGames || 0}
            </div>
          </>
        ) : (
          <div style={{ 
            fontStyle: 'italic', 
            color: '#999',
            padding: '10px 0'
          }}>
            待定
          </div>
        )}
      </div>
    );
  };  

  // 使用 maxSeq 參數以防止變數名重複

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
            <div className="text-2xl font-bold flex-1">{contestName} - {matchMode === 'league' ? '聯賽總結果' : matchMode === 'elimination' ? '淘汰賽勝負分支表' : isParentContest ? '多組競賽總覽' : '比賽名次分析'}</div>
            
            {isAdmin && (
              <button
                onClick={() => navigate('/contest-control')}
                className="mr-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors flex items-center gap-2"
              >
                <span>←</span>
                返回賽事控制台
              </button>
            )}
            
            <button 
              onClick={handleRefresh}
              disabled={refreshing || loading}
              className="ml-4"
              style={{
                backgroundColor: '#3b82f6',
                color: 'white',
                border: 'none',
                padding: '8px 16px',
                borderRadius: '4px',
                cursor: refreshing || loading ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '5px'
              }}
            >
              {refreshing ? '刷新中...' : '刷新結果'}
              {!refreshing && (
                <span style={{ marginLeft: '4px' }}>⟳</span>
              )}
            </button>
          </div>
          
          {/* 子賽事顯示區域 */}
          {isParentContest && childContests.length > 0 && (
            <div className="mb-8">
              <h3 className="text-xl font-bold mb-4 text-gray-800">子賽事狀況</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {childContests.map((child) => (
                  <div key={child.contest_id} className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
                    <div className="flex justify-between items-start mb-3">
                      <h4 className="font-bold text-lg text-gray-800">{child.contest_name}</h4>
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        child.contest_status === 'ongoing' 
                          ? 'bg-green-100 text-green-800' 
                          : child.contest_status === 'lineup_arrangement'
                          ? 'bg-yellow-100 text-yellow-800'
                          : child.contest_status === 'finished'
                          ? 'bg-gray-100 text-gray-800'
                          : 'bg-blue-100 text-blue-800'
                      }`}>
                        {child.contest_status === 'ongoing' && '比賽進行中'}
                        {child.contest_status === 'lineup_arrangement' && '名單安排中'}
                        {child.contest_status === 'finished' && '已結束'}
                        {child.contest_status === 'recruiting' && '招募中'}
                        {child.contest_status === 'WaitMatchForm' && '等待對戰表'}
                      </span>
                    </div>
                    
                    <div className="text-sm text-gray-600 mb-3">
                      <div>球場：{child.team_name}</div>
                      <div>建立者：{child.created_by}</div>
                      {child.advancement_rules && (
                        <div className="text-blue-600 font-medium">
                          晉級數：{child.advancement_rules.advancement_count || 
                                  child.advancement_rules.advances || 
                                  child.advancement_rules.advancement_team_count || 1} 隊
                        </div>
                      )}
                    </div>
                    
                    {/* 晉級隊伍顯示 */}
                    {child.qualified_teams && child.qualified_teams.length > 0 && (
                      <div className="mb-3 p-2 bg-green-50 border border-green-200 rounded">
                        <div className="text-sm font-medium text-green-800 mb-1">🏆 晉級隊伍：</div>
                        <div className="space-y-1">
                          {child.qualified_teams.map((team: any, index: number) => (
                            <div key={team.contest_team_id} className="text-sm text-green-700">
                              {index + 1}. {team.team_name}
                              {team.points !== undefined && (
                                <span className="ml-2 text-green-600">({team.points} 分)</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {/* 如果子賽事已完成但沒有晉級隊伍資料 */}
                    {child.contest_status === 'finished' && (!child.qualified_teams || child.qualified_teams.length === 0) && (
                      <div className="mb-3 p-2 bg-yellow-50 border border-yellow-200 rounded">
                        <div className="text-sm text-yellow-700">
                          ⚠️ 比賽已結束，但晉級隊伍資料尚未更新
                        </div>
                      </div>
                    )}
                    
                    <div className="flex gap-2">
                      {(child.contest_status === 'ongoing' || child.contest_status === 'lineup_arrangement') && (
                        <button
                          onClick={() => navigate(`/contest/${child.contest_id}/battleroom`)}
                          className="flex-1 bg-green-600 hover:bg-green-700 text-white px-3 py-2 rounded text-sm font-medium transition-colors"
                        >
                          戰況室
                        </button>
                      )}
                      
                      <button
                        onClick={() => navigate(`/contest/${child.contest_id}/results`)}
                        className={`flex-1 px-3 py-2 rounded text-sm font-medium transition-colors ${
                          child.contest_status === 'finished'
                            ? 'bg-purple-600 hover:bg-purple-700 text-white'
                            : 'bg-blue-600 hover:bg-blue-700 text-white'
                        }`}
                      >
                        {child.contest_status === 'finished' ? '比賽結果' : '賽況總覽'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {/* 根據比賽模式顯示不同的視圖 */}
          {matchMode === 'league' ? (
            // 聯賽模式：顯示分組賽和決賽結果
            <div className="space-y-6">
              {/* 分組賽結果 */}
              <div>
                <h3 className="text-xl font-bold mb-4 text-gray-800">分組賽結果</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {(resultsData as any).leagueData.groupResults.map((group: any) => (
                    <div key={group.contest_id} className="bg-white border rounded-lg p-4 shadow">
                      <h4 className="font-bold text-lg mb-2">{group.contest_name}</h4>
                      <p className="text-sm text-gray-600 mb-2">
                        狀態: <span className={`px-2 py-1 rounded text-xs ${group.contest_status === 'finished' ? 'bg-gray-500 text-white' : 'bg-green-500 text-white'}`}>
                          {group.contest_status === 'finished' ? '已完成' : '進行中'}
                        </span>
                      </p>
                      <div className="mb-3">
                        <p className="text-sm font-medium text-gray-700">參賽隊伍:</p>
                        <ul className="text-sm text-gray-600 ml-4">
                          {group.teams.map((team: any) => (
                            <li key={team.contest_team_id}>{team.team_name}</li>
                          ))}
                        </ul>
                      </div>
                      {group.champion && (
                        <div className="bg-yellow-100 border border-yellow-300 rounded p-2">
                          <p className="text-sm font-bold text-yellow-800">
                            🏆 分組冠軍: {group.champion.team_name}
                          </p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* 決賽結果 */}
              {(resultsData as any).leagueData.playoffResult && (
                <div>
                  <h3 className="text-xl font-bold mb-4 text-gray-800">決賽結果</h3>
                  <div className="bg-white border rounded-lg p-6 shadow">
                    <h4 className="font-bold text-lg mb-2">{(resultsData as any).leagueData.playoffResult.contest_name}</h4>
                    <p className="text-sm text-gray-600 mb-4">
                      狀態: <span className={`px-2 py-1 rounded text-xs ${(resultsData as any).leagueData.playoffResult.contest_status === 'finished' ? 'bg-gray-500 text-white' : 'bg-green-500 text-white'}`}>
                        {(resultsData as any).leagueData.playoffResult.contest_status === 'finished' ? '已完成' : '進行中'}
                      </span>
                    </p>
                    
                    <div className="mb-4">
                      <p className="text-sm font-medium text-gray-700 mb-2">晉級隊伍:</p>
                      <div className="grid grid-cols-2 gap-2">
                        {(resultsData as any).leagueData.playoffResult.teams.map((team: any) => (
                          <div key={team.contest_team_id} className="bg-blue-100 border border-blue-300 rounded p-2">
                            <p className="text-sm font-medium text-blue-800">{team.team_name}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    {(resultsData as any).leagueData.playoffResult.matches.length > 0 && (
                      <div>
                        <p className="text-sm font-medium text-gray-700 mb-2">比賽結果:</p>
                        <div className="space-y-2">
                          {(resultsData as any).leagueData.playoffResult.matches.map((match: any) => {
                            // 获取所有可能的队伍来源
                            const allGroupTeams = (resultsData as any).leagueData.groupResults.flatMap((group: any) => group.teams || []);
                            const champions = (resultsData as any).leagueData.groupResults
                              .map((group: any) => group.champion)
                              .filter(Boolean);
                            
                            // 首先尝试从决赛队伍中查找
                            let team1 = (resultsData as any).leagueData.playoffResult.teams.find((t: any) => t.contest_team_id === match.team1_id);
                            let team2 = (resultsData as any).leagueData.playoffResult.teams.find((t: any) => t.contest_team_id === match.team2_id);
                            
                            // 如果在决赛队伍中找不到，尝试从所有分组赛队伍中查找
                            if (!team1) {
                              team1 = allGroupTeams.find((t: any) => t.contest_team_id === match.team1_id);
                            }
                            if (!team2) {
                              team2 = allGroupTeams.find((t: any) => t.contest_team_id === match.team2_id);
                            }
                            
                            // 如果还是找不到，尝试从分组冠军中查找
                            if (!team1) {
                              const champion1 = champions.find((c: any) => c.team_id === match.team1_id);
                              if (champion1) {
                                team1 = { contest_team_id: champion1.team_id, team_name: champion1.team_name };
                              }
                            }
                            if (!team2) {
                              const champion2 = champions.find((c: any) => c.team_id === match.team2_id);
                              if (champion2) {
                                team2 = { contest_team_id: champion2.team_id, team_name: champion2.team_name };
                              }
                            }
                            
                            // 查找获胜者
                            let winner = (resultsData as any).leagueData.playoffResult.teams.find((t: any) => t.contest_team_id === match.winner_team_id);
                            if (!winner) {
                              winner = allGroupTeams.find((t: any) => t.contest_team_id === match.winner_team_id);
                            }
                            if (!winner) {
                              const winnerChampion = champions.find((c: any) => c.team_id === match.winner_team_id);
                              if (winnerChampion) {
                                winner = { contest_team_id: winnerChampion.team_id, team_name: winnerChampion.team_name };
                              }
                            }
                            
                            return (
                              <div key={match.match_id} className="bg-gray-50 border rounded p-3">
                                <div className="flex justify-between items-center">
                                  <span className="text-sm">
                                    {team1?.team_name || `队伍 ${match.team1_id}` || '待定'} vs {team2?.team_name || `队伍 ${match.team2_id}` || '待定'}
                                  </span>
                                  <div className="text-right">
                                    {match.score && (
                                      <span className="text-sm font-medium text-gray-700">
                                        比分: {match.score}
                                      </span>
                                    )}
                                    {winner && (
                                      <div className="text-sm font-bold text-green-600">
                                        獲勝: {winner.team_name}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 最終冠軍 */}
              {isContestFinished && (resultsData as any).leagueData.playoffResult && (resultsData as any).leagueData.playoffResult.matches.length > 0 && (
                <div className="bg-gradient-to-r from-yellow-400 to-yellow-600 text-white rounded-lg p-6 text-center">
                  <h3 className="text-2xl font-bold mb-2">🏆 總冠軍</h3>
                  {(() => {
                    const finalMatch = (resultsData as any).leagueData.playoffResult.matches
                      .filter((m: any) => m.winner_team_id)
                      .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
                    
                    if (finalMatch) {
                      // 获取所有可能的队伍来源
                      const allGroupTeams = (resultsData as any).leagueData.groupResults.flatMap((group: any) => group.teams || []);
                      const champions = (resultsData as any).leagueData.groupResults
                        .map((group: any) => group.champion)
                        .filter(Boolean);
                      
                      // 查找冠军队伍
                      let champion = (resultsData as any).leagueData.playoffResult.teams.find((t: any) => t.contest_team_id === finalMatch.winner_team_id);
                      if (!champion) {
                        champion = allGroupTeams.find((t: any) => t.contest_team_id === finalMatch.winner_team_id);
                      }
                      if (!champion) {
                        const winnerChampion = champions.find((c: any) => c.team_id === finalMatch.winner_team_id);
                        if (winnerChampion) {
                          champion = { contest_team_id: winnerChampion.team_id, team_name: winnerChampion.team_name };
                        }
                      }
                      
                      return champion ? (
                        <p className="text-xl font-bold">{champion.team_name}</p>
                      ) : (
                        <p className="text-lg">決賽進行中...</p>
                      );
                    }
                    return <p className="text-lg">決賽進行中...</p>;
                  })()}
                </div>
              )}
            </div>
          ) : matchMode === 'elimination' ? (
            // 淘汰賽模式：顯示淘汰賽圖表
            <div className="tournament-bracket-container" style={{
              padding: '20px 0',
              overflowX: 'auto',
              maxWidth: '100%',
              marginBottom: '20px'
            }}>
              {/* 淘汰賽獎牌排名區域 */}
              {bracketData && bracketData.rounds && Array.isArray(bracketData.rounds) && (
                <div className="tournament-rankings" style={{
                  marginBottom: '30px',
                  backgroundColor: '#f8f9fa',
                  borderRadius: '10px',
                  padding: '20px',
                  boxShadow: '0 2px 10px rgba(0, 0, 0, 0.05)'
                }}>
                  <h3 style={{
                    fontSize: '1.5rem',
                    fontWeight: 'bold',
                    marginBottom: '15px',
                    textAlign: 'center',
                    borderBottom: '2px solid #eaeaea',
                    paddingBottom: '10px'
                  }}>淘汰賽最終排名</h3>
                  <div style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    justifyContent: 'center',
                    gap: '20px'
                  }}>
                    {/* 冠軍 */}
                    {renderFinalRankingCard('🥇 冠軍', findFinalRanking(1), '#FFD700')}
                    
                    {/* 亞軍 */}
                    {renderFinalRankingCard('🥈 亞軍', findFinalRanking(2), '#C0C0C0')}
                    
                    {/* 季軍 */}
                    {renderFinalRankingCard('🥉 季軍', findFinalRanking(3), '#CD7F32')}
                    
                    {/* 第四名 */}
                    {renderFinalRankingCard('第四名', findFinalRanking(4), '#A9A9A9')}
                  </div>
                </div>
              )}
              
              {/* 淘汰賽圖表顯示 */}
              {bracketData && bracketData.rounds && Array.isArray(bracketData.rounds) ? (
                <div className="bracket-wrapper" style={{
                  display: 'flex',
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  gap: '25px',
                  overflow: 'auto'
                }}>
                  {/* 過濾出有實際比賽的輪次，即至少有一場比賽有隊伍信息 */}
                  {bracketData.rounds
                    .filter((round: any) => {
                      // 檢查該輪次是否有包含有效比賽
                      return round.matches && round.matches.some((match: any) => 
                        (match.team1Id && match.team1Id > 0) || 
                        (match.team2Id && match.team2Id > 0)
                      );
                    })
                    .map((round: any, roundIndex: number) => (
                    <div key={`round-${roundIndex}`} className="round" style={{
                      display: 'flex',
                      flexDirection: 'column',
                      minWidth: '280px'
                    }}>
                      <div className="round-header" style={{
                        fontSize: '1.2rem',
                        fontWeight: 'bold',
                        padding: '10px 0',
                        borderBottom: '2px solid #eee',
                        marginBottom: '15px',
                        textAlign: 'center'
                      }}>
                        {(() => {
                          // 計算總輪次數
                          const totalRounds = bracketData.rounds.length;
                          // 根據輪次與總輪次的關係顯示合適的階段名稱
                          if (roundIndex === totalRounds - 1) {
                            return '決賽';
                          } else if (roundIndex === totalRounds - 2) {
                            return '準決賽';
                          } else if (roundIndex === totalRounds - 3) {
                            return '八強賽';
                          } else if (roundIndex === totalRounds - 4) {
                            return '十六強賽';
                          } else {
                            return `第 ${roundIndex + 1} 輪`;
                          }
                        })()}
                      </div>
                      
                      <div className="matches" style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '30px'
                      }}>
                        {round.matches.map((match: any, matchIndex: number) => {
                          // 獲取比賽結果和團隊數據
                          const isTeam1Winner = match.winnerId === match.team1Id;
                          const isTeam2Winner = match.winnerId === match.team2Id;
                          const isMatchCompleted = match.winnerId != null;
                          
                          // 獲取團隊資訊
                          const team1Info = resultsData && resultsData.teams ? 
                                           resultsData.teams.find((t: TeamResult) => t && t.teamId === match.team1Id) : undefined;
                          const team2Info = resultsData && resultsData.teams ? 
                                           resultsData.teams.find((t: TeamResult) => t && t.teamId === match.team2Id) : undefined;
                          
                          // 優先使用 bracketData 中的隊伍名稱，然後是 resultsData.teams 中的名稱
                          let team1Name = match.team1Name || team1Info?.teamName;
                          let team2Name = match.team2Name || team2Info?.teamName;
                          
                          // 如果還是沒有名稱，嘗試從 bracketData.teamNames 中獲取
                          if (!team1Name && match.team1Id && bracketData?.teamNames) {
                            team1Name = bracketData.teamNames.get(match.team1Id);
                          }
                          
                          if (!team2Name && match.team2Id && bracketData?.teamNames) {
                            team2Name = bracketData.teamNames.get(match.team2Id);
                          }
                          
                          // 最後的備用方案
                          if (!team1Name && match.team1Id) {
                            team1Name = `隊伍 ${match.team1Id}`;
                          }
                          
                          if (!team2Name && match.team2Id) {
                            team2Name = `隊伍 ${match.team2Id}`;
                          }
                          
                          // 獲取比分數據
                          let team1Score = "";
                          let team2Score = "";
                          try {
                            if (match && match.team1Id && match.team2Id && typeof getMatchScore === 'function') {
                              team1Score = getMatchScore(match.team1Id, match.team2Id);
                              team2Score = getMatchScore(match.team2Id, match.team1Id);
                            }
                          } catch (err) {
                            console.error('獲取比分時出錯:', err);
                          }
                          
                          return (
                            <div key={`match-${roundIndex}-${matchIndex}`} className="match" style={{
                              display: 'flex',
                              flexDirection: 'column',
                              width: '100%',
                              position: 'relative',
                              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
                              borderRadius: '6px',
                              overflow: 'hidden',
                              backgroundColor: '#fff'
                            }}>
                              <div className="match-number" style={{
                                fontSize: '0.8rem',
                                color: '#888',
                                textAlign: 'center',
                                padding: '5px',
                                borderBottom: '1px solid #eee',
                                backgroundColor: '#f9f9f9'
                              }}>比賽 #{matchIndex + 1}</div>
                              
                              {/* 隊伍 1 */}
                              <div 
                                className={`match-slot ${!match.team1Id ? 'empty' : ''} ${isTeam1Winner ? 'winner' : isMatchCompleted ? 'loser' : ''}`}
                                style={{
                                  padding: '10px 15px',
                                  borderLeft: `5px solid ${isTeam1Winner ? '#4caf50' : isMatchCompleted ? '#f5f5f5' : '#f5f5f5'}`,
                                  borderBottom: '1px solid #eee',
                                  backgroundColor: isTeam1Winner ? '#f0fff1' : '#fff',
                                  transition: 'all 0.3s ease',
                                  position: 'relative',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between'
                                }}
                              >
                                {match.team1Id ? (
                                  <>
                                    <div className="team-info" style={{ flex: 1 }}>
                                      <div className="team-name" style={{ 
                                        fontWeight: isTeam1Winner ? 'bold' : 'normal',
                                        color: isTeam1Winner ? '#2e7d32' : '#333',
                                        fontSize: '0.95rem'
                                      }}>
                                        {team1Name || '未知隊伍'}
                                      </div>
                                      {isTeam1Winner && (
                                        <span style={{
                                          display: 'inline-block',
                                          marginLeft: '5px',
                                          color: '#4caf50',
                                          fontSize: '1rem'
                                        }}>🏆</span>
                                      )}
                                    </div>
                                    <div className="score-badge" style={{ 
                                      backgroundColor: isTeam1Winner ? '#4caf50' : '#9e9e9e',
                                      color: 'white',
                                      borderRadius: '12px',
                                      padding: '2px 10px',
                                      fontSize: '0.9rem',
                                      fontWeight: 'bold',
                                      transition: 'all 0.3s ease'
                                    }}>
                                      {team1Score || '0'}
                                    </div>
                                  </>
                                ) : (
                                  <div className="empty-slot" style={{ 
                                    width: '100%',
                                    textAlign: 'center', 
                                    color: '#999',
                                    fontStyle: 'italic',
                                    padding: '5px 0'
                                  }}>待定</div>
                                )}
                              </div>
                              
                              {/* 隊伍 2 */}
                              <div 
                                className={`match-slot ${!match.team2Id ? 'empty' : ''} ${isTeam2Winner ? 'winner' : isMatchCompleted ? 'loser' : ''}`}
                                style={{
                                  padding: '10px 15px',
                                  borderLeft: `5px solid ${isTeam2Winner ? '#4caf50' : isMatchCompleted ? '#f5f5f5' : '#f5f5f5'}`,
                                  backgroundColor: isTeam2Winner ? '#f0fff1' : '#fff',
                                  transition: 'all 0.3s ease',
                                  position: 'relative',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between'
                                }}
                              >
                                {match.team2Id ? (
                                  <>
                                    <div className="team-info" style={{ flex: 1 }}>
                                      <div className="team-name" style={{ 
                                        fontWeight: isTeam2Winner ? 'bold' : 'normal',
                                        color: isTeam2Winner ? '#2e7d32' : '#333',
                                        fontSize: '0.95rem'
                                      }}>
                                        {team2Name || '未知隊伍'}
                                      </div>
                                      {isTeam2Winner && (
                                        <span style={{
                                          display: 'inline-block',
                                          marginLeft: '5px',
                                          color: '#4caf50',
                                          fontSize: '1rem'
                                        }}>🏆</span>
                                      )}
                                    </div>
                                    <div className="score-badge" style={{ 
                                      backgroundColor: isTeam2Winner ? '#4caf50' : '#9e9e9e',
                                      color: 'white',
                                      borderRadius: '12px',
                                      padding: '2px 10px',
                                      fontSize: '0.9rem',
                                      fontWeight: 'bold',
                                      transition: 'all 0.3s ease'
                                    }}>
                                      {team2Score || '0'}
                                    </div>
                                  </>
                                ) : (
                                  <div className="empty-slot" style={{ 
                                    width: '100%',
                                    textAlign: 'center', 
                                    color: '#999',
                                    fontStyle: 'italic',
                                    padding: '5px 0'
                                  }}>待定</div>
                                )}
                              </div>
                              
                              {/* 比賽狀態 */}
                              <div className="match-status" style={{
                                position: 'absolute',
                                bottom: '5px',
                                right: '5px',
                                fontSize: '0.75rem',
                                color: isMatchCompleted ? '#4caf50' : '#9e9e9e',
                                fontWeight: isMatchCompleted ? 'bold' : 'normal'
                              }}>
                                {isMatchCompleted ? '已完成' : '未開始'}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="no-data" style={{
                  textAlign: 'center',
                  padding: '30px 0',
                  color: '#666',
                  backgroundColor: '#f9f9f9',
                  borderRadius: '8px',
                  border: '1px dashed #ddd',
                  margin: '20px 0'
                }}>
                  <p>淘汰賽圖表尚未設置，請先建立比賽。</p>
                  <p style={{ fontSize: '0.9rem', color: '#888', marginTop: '10px' }}>
                    當比賽結果錄入後，圖表將自動生成和更新
                  </p>
                </div>
              )}
            </div>
          ) : (
            // 循環賽模式：顯示分數表
            resultsData.teams.length === 0 ? (
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
            )
          )}
          
          {isContestFinished && (
            <div className="mt-8 mb-6">
              {matchMode === 'league' ? (
                // 联赛模式：显示子赛事链接
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <h3 className="text-lg font-semibold text-blue-800 mb-4">詳細個人對戰記錄</h3>
                  <p className="text-sm text-gray-600 mb-4">點擊下方連結查看各賽事的詳細對戰記錄：</p>
                  
                  <div className="space-y-3">
                    {/* 分组赛链接 */}
                    {(resultsData as any).leagueData?.groupResults?.map((group: any) => (
                      <div key={group.contest_id} className="flex items-center justify-between bg-white p-3 rounded border">
                        <div>
                          <h4 className="font-medium text-gray-800">{group.contest_name}</h4>
                          <p className="text-sm text-gray-500">
                            狀態: {group.contest_status === 'finished' ? '已完成' : '進行中'}
                            {group.champion && (
                              <span className="ml-2 text-yellow-600">
                                🏆 冠軍: {group.champion.team_name}
                              </span>
                            )}
                          </p>
                        </div>
                        <button
                          onClick={() => navigate(`/contest/${group.contest_id}/results`)}
                          className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded text-sm transition-colors"
                        >
                          查看詳細記錄
                        </button>
                      </div>
                    ))}
                    
                    {/* 决赛链接 */}
                    {(resultsData as any).leagueData?.playoffResult && (
                      <div className="flex items-center justify-between bg-white p-3 rounded border border-yellow-300">
                        <div>
                          <h4 className="font-medium text-gray-800">{(resultsData as any).leagueData.playoffResult.contest_name}</h4>
                          <p className="text-sm text-gray-500">
                            狀態: {(resultsData as any).leagueData.playoffResult.contest_status === 'finished' ? '已完成' : '進行中'}
                            <span className="ml-2 text-yellow-600">🏆 決賽階段</span>
                          </p>
                        </div>
                        <button
                          onClick={() => navigate(`/contest/${(resultsData as any).leagueData.playoffResult.contest_id}/results`)}
                          className="bg-yellow-500 hover:bg-yellow-600 text-white px-4 py-2 rounded text-sm transition-colors"
                        >
                          查看詳細記錄
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                // 非联赛模式：原有的详细记录展开功能
                <>
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
                </>
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
              {matchMode === 'league' ? (
                // 聯賽模式說明
                <>
                  <li>聯賽分為分組賽和決賽兩個階段。</li>
                  <li>分組賽採用循環賽制，各組冠軍晉級決賽。</li>
                  <li>決賽階段採用淘汰賽制，決出總冠軍。</li>
                  <li>比賽結果顯示各分組的參賽隊伍和冠軍。</li>
                  <li>決賽結果顯示晉級隊伍的對戰情況和最終獲勝者。</li>
                  {isContestFinished && (
                    <li className="text-blue-700 font-medium">比賽結束後可展開查看詳細個人對戰記錄，包含每局選手對戰情況。</li>
                  )}
                </>
              ) : matchMode === 'elimination' ? (
                // 淘汰賽模式說明
                <>
                  <li>淘汰賽採用單敗淘汰制，敗者即被淘汰。</li>
                  <li>圖表從左到右顯示各輪比賽，最右側為決賽。</li>
                  <li>每場比賽的獲勝者晉級下一輪，敗者被淘汰。</li>
                  <li>比賽狀態顯示為「已完成」或「未開始」。</li>
                  <li>獲勝隊伍以綠色背景和🏆圖標標示。</li>
                  <li>最終排名顯示冠軍、亞軍、季軍和第四名。</li>
                  <li>比分顯示各隊在該場比賽中獲勝的局數。</li>
                  {isContestFinished && (
                    <li className="text-blue-700 font-medium">比賽結束後可展開查看詳細個人對戰記錄，包含每局選手對戰情況。</li>
                  )}
                </>
              ) : (
                // 循環賽模式說明（原有內容）
                <>
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
                </>
              )}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
};

export default ContestResultsPage;