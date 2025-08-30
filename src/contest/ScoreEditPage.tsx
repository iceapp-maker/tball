// ScoreEditPage.tsx 增強版本 - 在緊急版基礎上逐步添加功能

import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../supabaseClient';

interface MatchDetail {
  match_detail_id: number;
  match_id: number;
  team1_member_ids: string[] | string;
  team2_member_ids: string[] | string;
  winner_team_id: number | null;
  score: string | null;
  sequence: number;
  match_type: 'single' | 'double' | '單打' | '雙打';
  table_no: number | string | null;
  team1_name: string;
  team2_name: string;
  team1_id: number | undefined;
  team2_id: number | undefined;
}

const ScoreEditPage: React.FC = () => {
  const { contestId, matchId } = useParams<{ contestId: string; matchId?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  
  const [match, setMatch] = useState<MatchDetail | null>(null);
  const [team1Score, setTeam1Score] = useState('');
  const [team2Score, setTeam2Score] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [adminName, setAdminName] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);

  // 管理員檢查
  useEffect(() => {
    try {
      const storedUser = JSON.parse(localStorage.getItem('loginUser') || '{}');
      const isUserAdmin = storedUser.role === 'admin' || storedUser.is_admin === true;
      const username = storedUser.userName || storedUser.username || storedUser.name || '管理員';
      
      setIsAdmin(isUserAdmin);
      setAdminName(username);
      
      if (!isUserAdmin) {
        navigate(`/contest/${contestId}/battleroom`);
      }
    } catch (err) {
      console.error('獲取管理員資訊錯誤:', err);
      navigate(`/contest/${contestId}/battleroom`);
    }
  }, [contestId, navigate]);

  // 數據初始化
  useEffect(() => {
    if (!isAdmin) return;
    
    try {
      // 優先從 location.state 獲取數據
      if (location.state && location.state.matchDetailId) {
        const stateData = location.state;
        
        // 如果有完整的 match 數據，直接使用
        if (stateData.match && stateData.match.match_detail_id) {
          setMatch(stateData.match);
          if (stateData.match.score) {
            const [score1, score2] = stateData.match.score.split(':');
            setTeam1Score(score1 || '');
            setTeam2Score(score2 || '');
          }
          return;
        }
        
        // 否則從數據庫獲取
        fetchMatchData(stateData.matchDetailId);
        return;
      }
      
      // 從 URL 參數獲取 - 支援 matchId 參數
      if (matchId && matchId !== 'new') {
        // 如果有 matchId，先獲取該比賽的詳細資料
        fetchMatchByMatchId(parseInt(matchId));
        return;
      }
      
      // 從 URL 查詢參數獲取
      const urlParams = new URLSearchParams(location.search);
      const matchDetailId = urlParams.get('matchDetailId');
      
      if (matchDetailId) {
        fetchMatchData(parseInt(matchDetailId));
        return;
      }
      
      // 如果是 'new'，創建新的比賽詳細資料
      if (matchId === 'new') {
        setError('創建新比賽功能尚未實現');
        return;
      }
      
      setError('缺少比賽資料');
    } catch (err) {
      console.error('初始化錯誤:', err);
      setError('初始化失敗');
    }
  }, [location, isAdmin]);

  // 根據 match_id 獲取比賽資料
  const fetchMatchByMatchId = async (matchId: number) => {
    try {
      setIsLoading(true);
      setError('');
      
      // 先獲取比賽基本資料
      const { data: matchData, error: matchError } = await supabase
        .from('contest_match')
        .select('match_id, team1_id, team2_id')
        .eq('match_id', matchId)
        .single();

      if (matchError) throw matchError;

      // 獲取比賽詳細資料（如果存在）
      const { data: detailData, error: detailError } = await supabase
        .from('contest_match_detail')
        .select('*')
        .eq('match_id', matchId)
        .maybeSingle();

      // 如果沒有詳細資料，創建一個基本的 match 對象
      if (!detailData) {
        // 獲取隊伍名稱
        const teamIds = [matchData.team1_id, matchData.team2_id].filter(Boolean);
        const { data: teamData, error: teamError } = await supabase
          .from('contest_team')
          .select('contest_team_id, team_name')
          .in('contest_team_id', teamIds);

        if (teamError) throw teamError;

        const team1 = teamData?.find(t => t.contest_team_id === matchData.team1_id);
        const team2 = teamData?.find(t => t.contest_team_id === matchData.team2_id);

        setMatch({
          match_detail_id: 0, // 新比賽
          match_id: matchId,
          team1_member_ids: [],
          team2_member_ids: [],
          winner_team_id: null,
          score: null,
          sequence: 1,
          match_type: 'single',
          table_no: null,
          team1_name: team1?.team_name || '隊伍1',
          team2_name: team2?.team_name || '隊伍2',
          team1_id: matchData.team1_id,
          team2_id: matchData.team2_id
        });
      } else {
        // 有詳細資料，繼續原有邏輯
        await fetchMatchData(detailData.match_detail_id);
      }
      
    } catch (err) {
      console.error('獲取比賽資料失敗:', err);
      setError('獲取比賽資料失敗');
    } finally {
      setIsLoading(false);
    }
  };

  // 數據獲取函數
  const fetchMatchData = async (matchDetailId: number) => {
    try {
      setIsLoading(true);
      setError('');
      
      const { data: detailData, error: detailError } = await supabase
        .from('contest_match_detail')
        .select('*')
        .eq('match_detail_id', matchDetailId)
        .single();

      if (detailError) throw detailError;

      const { data: matchData, error: matchError } = await supabase
        .from('contest_match')
        .select('match_id, team1_id, team2_id')
        .eq('match_id', detailData.match_id)
        .single();

      if (matchError) throw matchError;

      const teamIds = [matchData.team1_id, matchData.team2_id].filter(Boolean);
      const { data: teamData, error: teamError } = await supabase
        .from('contest_team')
        .select('contest_team_id, team_name')
        .in('contest_team_id', teamIds);

      if (teamError) throw teamError;

      const team1 = teamData.find(t => t.contest_team_id === matchData.team1_id);
      const team2 = teamData.find(t => t.contest_team_id === matchData.team2_id);

      const processedMatch: MatchDetail = {
        ...detailData,
        team1_id: matchData.team1_id,
        team2_id: matchData.team2_id,
        team1_name: team1?.team_name || '',
        team2_name: team2?.team_name || ''
      };

      setMatch(processedMatch);
      
      if (processedMatch.score) {
        const [score1, score2] = processedMatch.score.split(':');
        setTeam1Score(score1 || '');
        setTeam2Score(score2 || '');
      }
    } catch (err: any) {
      console.error('獲取比賽資料錯誤:', err);
      setError(err.message || '獲取資料失敗');
    } finally {
      setIsLoading(false);
    }
  };

  // 新增：遊戲記錄表更新功能
  const updateGameTables = async (newScore: string, newWinnerTeamId: number | null) => {
    if (!match) return;

    try {
      console.log('開始更新遊戲記錄表...');
      
      // 從 contest_match_detail 獲取選手成員ID
      const { data: matchDetailData, error: matchDetailError } = await supabase
        .from('contest_match_detail')
        .select('team1_member_ids, team2_member_ids')
        .eq('match_detail_id', match.match_detail_id)
        .single();

      if (matchDetailError || !matchDetailData) {
        console.error('獲取選手成員ID失敗:', matchDetailError);
        return;
      }

      // 解析成員ID陣列
      const team1MemberIds = typeof matchDetailData.team1_member_ids === 'string' 
        ? JSON.parse(matchDetailData.team1_member_ids) 
        : matchDetailData.team1_member_ids || [];
      
      const team2MemberIds = typeof matchDetailData.team2_member_ids === 'string' 
        ? JSON.parse(matchDetailData.team2_member_ids) 
        : matchDetailData.team2_member_ids || [];

      // 從 members 表獲取對應的 UUID
      const allMemberIds = [...team1MemberIds, ...team2MemberIds];
      if (allMemberIds.length === 0) {
        console.log('沒有成員ID，跳過遊戲記錄表更新');
        return;
      }

      const { data: membersData, error: membersError } = await supabase
        .from('members')
        .select('member_id, id, name')
        .in('member_id', allMemberIds);

      if (membersError || !membersData) {
        console.error('獲取會員UUID失敗:', membersError);
        return;
      }

      // 建立 member_id 到 UUID 的映射
      const memberIdToUuid: { [key: string]: string } = {};
      const memberIdToName: { [key: string]: string } = {};
      membersData.forEach(member => {
        memberIdToUuid[member.member_id] = member.id;
        memberIdToName[member.member_id] = member.name;
      });

      // 判斷比賽類型並更新對應表
      const isSingleMatch = match.match_type === 'single' || match.match_type === '單打';
      
      if (isSingleMatch) {
        await updateSingleGameTable(newScore, newWinnerTeamId, team1MemberIds, team2MemberIds, memberIdToUuid, memberIdToName);
      } else {
        await updateDoubleGameTable(newScore, newWinnerTeamId, team1MemberIds, team2MemberIds, memberIdToUuid, memberIdToName);
      }

      console.log('遊戲記錄表更新完成');
    } catch (error) {
      console.error('更新遊戲記錄表時出錯:', error);
      // 不要拋出錯誤，避免中斷主要流程
    }
  };

  // 新增：更新單打遊戲記錄表
  const updateSingleGameTable = async (
    newScore: string, 
    newWinnerTeamId: number | null,
    team1MemberIds: string[],
    team2MemberIds: string[],
    memberIdToUuid: { [key: string]: string },
    memberIdToName: { [key: string]: string }
  ) => {
    if (!match) return;

    // 確定獲勝選手
    let winnerName = '';
    let winnerUuid = '';
    
    if (newWinnerTeamId === match.team1_id && team1MemberIds.length > 0) {
      const winnerId = team1MemberIds[0];
      winnerName = memberIdToName[winnerId] || '';
      winnerUuid = memberIdToUuid[winnerId] || '';
    } else if (newWinnerTeamId === match.team2_id && team2MemberIds.length > 0) {
      const winnerId = team2MemberIds[0];
      winnerName = memberIdToName[winnerId] || '';
      winnerUuid = memberIdToUuid[winnerId] || '';
    }

    // 更新 g_single_game 表
    const { error: updateSingleError } = await supabase
      .from('g_single_game')
      .update({
        score: newScore,
        win1_name: winnerName,
        win1_id: winnerUuid
      })
      .eq('source_id', match.match_detail_id);

    if (updateSingleError) {
      console.error('更新單打記錄失敗:', updateSingleError);
      throw new Error(`更新單打記錄失敗: ${updateSingleError.message}`);
    }
  };

  // 新增：更新雙打遊戲記錄表
  const updateDoubleGameTable = async (
    newScore: string, 
    newWinnerTeamId: number | null,
    team1MemberIds: string[],
    team2MemberIds: string[],
    memberIdToUuid: { [key: string]: string },
    memberIdToName: { [key: string]: string }
  ) => {
    if (!match) return;

    // 確定獲勝選手
    let win1Name = '';
    let win2Name = '';
    let win1Uuid = '';
    let win2Uuid = '';
    
    if (newWinnerTeamId === match.team1_id && team1MemberIds.length >= 2) {
      win1Name = memberIdToName[team1MemberIds[0]] || '';
      win2Name = memberIdToName[team1MemberIds[1]] || '';
      win1Uuid = memberIdToUuid[team1MemberIds[0]] || '';
      win2Uuid = memberIdToUuid[team1MemberIds[1]] || '';
    } else if (newWinnerTeamId === match.team2_id && team2MemberIds.length >= 2) {
      win1Name = memberIdToName[team2MemberIds[0]] || '';
      win2Name = memberIdToName[team2MemberIds[1]] || '';
      win1Uuid = memberIdToUuid[team2MemberIds[0]] || '';
      win2Uuid = memberIdToUuid[team2MemberIds[1]] || '';
    }

    // 更新 g_double_game 表
    const { error: updateDoubleError } = await supabase
      .from('g_double_game')
      .update({
        score: newScore,
        win1_name: win1Name,
        win2_name: win2Name,
        win1_id: win1Uuid,
        win2_id: win2Uuid
      })
      .eq('source_id', match.match_detail_id);

    if (updateDoubleError) {
      console.error('更新雙打記錄失敗:', updateDoubleError);
      throw new Error(`更新雙打記錄失敗: ${updateDoubleError.message}`);
    }
  };

  // 比分驗證
  const isValidScore = () => {
    const score1 = parseInt(team1Score);
    const score2 = parseInt(team2Score);
    return !isNaN(score1) && !isNaN(score2) && score1 >= 0 && score2 >= 0;
  };

  const hasScoreChanged = () => {
    if (!match?.score) return true;
    const [currentScore1, currentScore2] = match.score.split(':');
    return team1Score !== currentScore1 || team2Score !== currentScore2;
  };

  // 新增：計算新的獲勝方
  const getNewWinner = () => {
    const score1 = parseInt(team1Score) || 0;
    const score2 = parseInt(team2Score) || 0;
    if (score1 > score2) return match?.team1_name || '';
    if (score2 > score1) return match?.team2_name || '';
    return '平局';
  };

  // 新增：計算當前獲勝方
  const getCurrentWinner = () => {
    if (!match?.score) return '未知';
    const [score1, score2] = match.score.split(':');
    const currentScore1 = parseInt(score1) || 0;
    const currentScore2 = parseInt(score2) || 0;
    if (currentScore1 > currentScore2) return match.team1_name;
    if (currentScore2 > currentScore1) return match.team2_name;
    return '平局';
  };

  // 增強的確認處理
  const handleConfirm = async () => {
    if (!match || !isValidScore() || !hasScoreChanged()) return;
    
    try {
      setIsLoading(true);
      setError('');
      
      const newScore = `${team1Score}:${team2Score}`;
      const team1ScoreNum = parseInt(team1Score);
      const team2ScoreNum = parseInt(team2Score);
      
      let newWinnerTeamId: number | null = null;
      if (team1ScoreNum > team2ScoreNum) {
        newWinnerTeamId = match.team1_id || null;
      } else if (team2ScoreNum > team1ScoreNum) {
        newWinnerTeamId = match.team2_id || null;
      }

      // 1. 更新 contest_match_detail 表（主要功能）
      const { error: updateError } = await supabase
        .from('contest_match_detail')
        .update({
          score: newScore,
          winner_team_id: newWinnerTeamId,
          modified_by: adminName
        })
        .eq('match_detail_id', match.match_detail_id);

      if (updateError) {
        throw new Error(`更新比賽詳情失敗: ${updateError.message}`);
      }

      // 2. 嘗試更新遊戲記錄表（附加功能，失敗不影響主流程）
      try {
        await updateGameTables(newScore, newWinnerTeamId);
      } catch (gameTableError) {
        console.error('更新遊戲記錄表失敗，但主要更新已成功:', gameTableError);
        // 不中斷流程，只記錄錯誤
      }

      // 3. 成功後返回戰況室
      navigate(`/contest/${contestId}/battleroom`, {
        state: {
          scoreUpdateSuccess: true,
          updatedMatchId: match.match_detail_id,
          message: `比分已成功修改為 ${newScore}`
        }
      });

    } catch (error: any) {
      console.error('修改比分錯誤:', error);
      setError(error.message || '修改失敗');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    navigate(`/contest/${contestId}/battleroom`);
  };

  // 渲染邏輯
  if (!isAdmin) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center text-red-500">權限不足，正在重定向...</div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center">載入中...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center text-red-500 mb-4">{error}</div>
        <div className="text-center">
          <button
            onClick={handleCancel}
            className="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded"
          >
            返回戰況室
          </button>
        </div>
      </div>
    );
  }

  if (!match) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center text-red-500 mb-4">找不到比賽資料</div>
        <div className="text-center">
          <button
            onClick={handleCancel}
            className="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded"
          >
            返回戰況室
          </button>
        </div>
      </div>
    );
  }

  const currentWinner = getCurrentWinner();
  const newWinner = getNewWinner();
  const winnerChanged = currentWinner !== newWinner;

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl">
      {/* 頁面標題 */}
      <div className="flex items-center mb-6">
        <button 
          onClick={handleCancel}
          className="mr-4 bg-gray-200 hover:bg-gray-300 p-2 rounded-full"
        >
          &larr;
        </button>
        <h1 className="text-2xl font-bold text-red-600">⚠️ 修改比分功能</h1>
      </div>

      {/* 警告訊息 */}
      <div className="bg-red-50 border border-red-200 p-4 rounded-lg mb-6">
        <div className="flex items-center">
          <div className="text-red-600 mr-2">⚠️</div>
          <div className="text-red-800">
            <strong>重要提醒：</strong>管理員請謹慎使用此功能，此操作將覆蓋原始比分記錄並無法撤銷。
          </div>
        </div>
      </div>

      {/* 比賽資訊卡片 */}
      <div className="bg-white border rounded-lg shadow-sm p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">比賽資訊</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div className="bg-gray-50 p-3 rounded">
            <div className="text-sm text-gray-600">比賽ID</div>
            <div className="font-medium">{match.match_detail_id}</div>
          </div>
          <div className="bg-gray-50 p-3 rounded">
            <div className="text-sm text-gray-600">比賽類型</div>
            <div className="font-medium">
              {match.match_type === 'single' || match.match_type === '單打' ? '單打' : '雙打'}
            </div>
          </div>
        </div>

        <div className="text-center py-4">
          <div className="text-xl font-bold">
            {match.team1_name} <span className="text-gray-400">vs</span> {match.team2_name}
          </div>
        </div>

        <div className="bg-blue-50 p-3 rounded">
          <div className="text-sm text-gray-600">當前比分</div>
          <div className="font-bold text-lg">
            {match.score || '未記錄'} 
            {match.score && (
              <span className="ml-2 text-blue-600 text-sm">({currentWinner}獲勝)</span>
            )}
          </div>
        </div>
      </div>

      {/* 比分修改表單 */}
      <div className="bg-white border rounded-lg shadow-sm p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">修改比分</h2>
        
        <div className="flex items-center justify-center space-x-4 mb-6">
          <div className="text-center flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {match.team1_name}
            </label>
            <input
              type="number"
              min="0"
              value={team1Score}
              onChange={(e) => setTeam1Score(e.target.value)}
              className="w-full p-3 border border-gray-300 rounded-md text-center text-xl font-bold focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="0"
            />
          </div>
          
          <div className="text-2xl font-bold text-gray-500 pt-8">:</div>
          
          <div className="text-center flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {match.team2_name}
            </label>
            <input
              type="number"
              min="0"
              value={team2Score}
              onChange={(e) => setTeam2Score(e.target.value)}
              className="w-full p-3 border border-gray-300 rounded-md text-center text-xl font-bold focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="0"
            />
          </div>
        </div>

        {/* 即時顯示新獲勝方 */}
        {isValidScore() && (
          <div className="bg-blue-50 p-4 rounded-lg mb-4">
            <div className="text-blue-800">
              <strong>新比分預覽：</strong>{team1Score}:{team2Score} → <strong>{newWinner}獲勝</strong>
              {winnerChanged && (
                <div className="text-orange-600 mt-1 text-sm">
                  ⚠️ 獲勝方將發生變化
                </div>
              )}
            </div>
          </div>
        )}

        {/* 確認資訊 */}
        {isValidScore() && hasScoreChanged() && (
          <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-lg mb-4">
            <div className="text-yellow-800">
              <strong>確認修改：</strong><br />
              比分從 <span className="font-mono bg-white px-2 py-1 rounded">{match.score || '未記錄'}</span> 
              改為 <span className="font-mono bg-white px-2 py-1 rounded">{team1Score}:{team2Score}</span>
              {winnerChanged && (
                <><br />獲勝方從 <strong>{currentWinner}</strong> 改為 <strong>{newWinner}</strong></>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 操作者資訊 */}
      <div className="bg-gray-50 p-3 rounded-lg mb-6">
        <div className="text-sm text-gray-600">
          操作者：<span className="font-medium">{adminName}</span>
        </div>
      </div>

      {/* 按鈕區域 */}
      <div className="flex space-x-4">
        <button
          onClick={handleCancel}
          disabled={isLoading}
          className="flex-1 px-6 py-3 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 disabled:opacity-50 font-medium"
        >
          取消
        </button>
        <button
          onClick={handleConfirm}
          disabled={!isValidScore() || !hasScoreChanged() || isLoading}
          className="flex-1 px-6 py-3 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
        >
          {isLoading ? '修改中...' : '確認修改'}
        </button>
      </div>
    </div>
  );
};

export default ScoreEditPage;