import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";
import { finishContest } from './utils/contestFinishAndAdvancement';

// 改進的主賽事狀態管理
async function syncMainContestStatus(contestId: string): Promise<void> {
  try {
    // 1. 獲取當前狀態和子賽事情況
    const { data: currentContest, error: currentError } = await supabase
      .from('contest')
      .select('contest_status, contest_type')
      .eq('contest_id', contestId)
      .single();

    if (currentError || currentContest.contest_type !== 'league_parent') return;

    // 2. 檢查子賽事狀態
    const { data: subContests, error: subError } = await supabase
      .from('contest')
      .select('contest_id, contest_status')
      .eq('parent_contest_id', contestId);

    if (subError) throw subError;

    // 3. 檢查待排清單
    const { data: allTeams, error: teamsError } = await supabase
      .from('contest_team')
      .select('contest_team_id')
      .eq('contest_id', contestId);

    if (teamsError) throw teamsError;

    const subContestIds = subContests?.map(s => s.contest_id) || [];
    let assignedTeamsCount = 0;
    
    if (subContestIds.length > 0) {
      const { count } = await supabase
        .from('contest_group_assignment')
        .select('contest_team_id', { count: 'exact' })
        .in('group_contest_id', subContestIds);
      assignedTeamsCount = count || 0;
    }

    const pendingTeamsCount = (allTeams?.length || 0) - assignedTeamsCount;

    // 4. 根據實際條件決定狀態
    let targetStatus = 'WaitMatchForm';
    
    const hasSubContests = (subContests?.length || 0) > 0;
    const hasOngoingSubContests = subContests?.some(s => s.contest_status === 'ongoing') || false;
    const hasFinishedSubContests = subContests?.some(s => s.contest_status === 'finished') || false;
    const allSubContestsFinished = hasSubContests && subContests?.every(s => s.contest_status === 'finished') || false;

    // 移除自動設為 finished 的邏輯 - 主賽事結束應由管理者手動決定
    if (hasOngoingSubContests || (hasFinishedSubContests && !allSubContestsFinished)) {
      targetStatus = 'ongoing';
    } else if (hasSubContests) {
      // 有子賽事存在就保持 ongoing 狀態，讓管理者決定是否結束或創建下一階段
      targetStatus = 'ongoing';
    }

    // 5. 更新狀態（如果需要）
    if (currentContest.contest_status !== targetStatus) {
      const { error: updateError } = await supabase
        .from('contest')
        .update({ contest_status: targetStatus })
        .eq('contest_id', contestId);

      if (updateError) throw updateError;
      
      console.log(`主賽事狀態同步: ${currentContest.contest_status} → ${targetStatus}`);
    }

  } catch (error) {
    console.error('同步主賽事狀態失敗:', error);
  }
}

// 類型定義
interface TeamData {
  contest_team_id: number;
  team_name: string;
  captain_name?: string;
}

interface ContestData {
  contest_id: string;
  contest_name: string;
  contest_status: string;
  contest_type: string;
  match_mode: string;
  parent_contest_id: string | null;
  expected_teams?: number;
  bracket_structure?: any;
  advancement_rules?: any;
  stage_order?: number;
  parallel_group?: string;
}

interface SubContestData extends ContestData {
  team_count?: number;
  qualified_teams?: TeamData[];
}

interface PendingTeam {
  contest_team_id: number;
  team_name: string;
  source: string; // 來源：'main' | 'sub_contest_id'
  qualified_rank?: number;
}

const CustomTournamentPage: React.FC = () => {
  const { contestId } = useParams<{ contestId: string }>();
  const navigate = useNavigate();
  
  // 基本狀態
  const [contestData, setContestData] = useState<ContestData | null>(null);
  const [subContests, setSubContests] = useState<SubContestData[]>([]);
  const [pendingTeams, setPendingTeams] = useState<PendingTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [showFinishPrompt, setShowFinishPrompt] = useState(false);
  
  // 新增子賽事狀態
  const [showCreateSubContest, setShowCreateSubContest] = useState(false);
  const [newSubContest, setNewSubContest] = useState({
    contest_name: '',
    match_mode: 'elimination' as 'round_robin' | 'elimination',
    advancement_count: 2,
    rule_text: '',
    stage_order: 1,
    parallel_group: ''
  });
  
  // 階段展開/收合狀態
  const [expandedStages, setExpandedStages] = useState<{[key: number]: boolean}>({});
  
  // 顯示隊伍列表狀態
  const [showTeamsList, setShowTeamsList] = useState<{[key: string]: boolean}>({});
  const [subContestTeams, setSubContestTeams] = useState<{[key: string]: TeamData[]}>({});

  // 獲取登錄用戶信息
  const user = JSON.parse(localStorage.getItem('loginUser') || '{}');

  // 檢查是否可以顯示「確定比賽結束」按鈕
  const canShowFinishButton = () => {
    // 條件1：有子賽事存在
    const hasSubContests = subContests.length > 0;
    
    // 條件2：所有子賽事都已完成
    const allSubContestsFinished = subContests.every(sub => sub.contest_status === 'finished');
    
    // 條件3：主賽事尚未結束
    const mainContestNotFinished = contestData?.contest_status !== 'finished';
    
    // 🔍 詳細調試信息
    console.log('=== 🔍 按鈕顯示條件檢查 ===');
    console.log('子賽事列表:', subContests.map(s => ({ 
      id: s.contest_id, 
      name: s.contest_name, 
      status: s.contest_status 
    })));
    console.log('條件1 - 有子賽事存在:', hasSubContests, `(${subContests.length}個)`);
    console.log('條件2 - 所有子賽事都已完成:', allSubContestsFinished);
    console.log('條件3 - 主賽事尚未結束:', mainContestNotFinished, `(當前狀態: ${contestData?.contest_status})`);
    console.log('最終結果 - 顯示按鈕:', hasSubContests && allSubContestsFinished && mainContestNotFinished);
    console.log('========================');
    
    // 只有當所有子賽事都完成且主賽事未結束時才顯示按鈕
    return hasSubContests && allSubContestsFinished && mainContestNotFinished;
  };

  // 獲取子賽事的隊伍列表
  const fetchSubContestTeams = async (subContestId: string) => {
    try {
      console.log(`🔄 重新載入待排清單，父賽事ID: ${contestId}`);
      
      // 獲取父賽事的所有隊伍
      const { data: groupAssignments, error: groupError } = await supabase
        .from('contest_group_assignment')
        .select('contest_team_id')
        .eq('group_contest_id', subContestId);
      
      if (groupError) throw groupError;
      
      if (!groupAssignments || groupAssignments.length === 0) {
        setSubContestTeams(prev => ({ ...prev, [subContestId]: [] }));
        return;
      }
      
      // 獲取隊伍詳細資料
      const teamIds = groupAssignments.map(a => a.contest_team_id);
      const { data: teamDetails, error: teamError } = await supabase
        .from('contest_team')
        .select('contest_team_id, team_name')
        .in('contest_team_id', teamIds);
      
      if (teamError) throw teamError;
      
      // 獲取隊長資訊
      const teamsWithCaptains = [];
      for (const team of teamDetails || []) {
        const { data: captainData } = await supabase
          .from('contest_team_member')
          .select('member_name')
          .eq('contest_team_id', team.contest_team_id)
          .eq('status', 'captain')
          .single();
        
        teamsWithCaptains.push({
          ...team,
          captain_name: captainData?.member_name || '未指定'
        });
      }
      
      setSubContestTeams(prev => ({ ...prev, [subContestId]: teamsWithCaptains }));
    } catch (error) {
      console.error('獲取子賽事隊伍失敗:', error);
      setError('獲取隊伍資料失敗');
    }
  };

  // 切換顯示隊伍列表
  const toggleTeamsList = async (subContestId: string) => {
    const isCurrentlyShowing = showTeamsList[subContestId];
    
    if (!isCurrentlyShowing) {
      // 如果還沒有載入過隊伍資料，先載入
      if (!subContestTeams[subContestId]) {
        await fetchSubContestTeams(subContestId);
      }
    }
    
    setShowTeamsList(prev => ({
      ...prev,
      [subContestId]: !isCurrentlyShowing
    }));
  };

  // 獲取主賽事資料
  const fetchContestData = async () => {
    try {
      setLoading(true);
      setError('');
      
      // 獲取主賽事資料
      const { data: contestData, error: contestError } = await supabase
        .from('contest')
        .select('*')
        .eq('contest_id', contestId)
        .single();
      
      if (contestError) throw contestError;
      
      // 檢查是否為混合賽主賽事
      if (contestData.contest_type !== 'league_parent') {
        setError('此頁面僅適用於混合賽管理');
        return;
      }
      
      // 🔧 修正：先設置 contestData，確保 fetchPendingTeams 能正確讀取狀態
      setContestData(contestData);
      
      // 🔧 修正：等待狀態更新後再獲取其他數據
      // 使用 setTimeout 確保 React 狀態更新完成
      setTimeout(async () => {
        try {
          // 獲取子賽事列表
          await fetchSubContests();
          
          // 獲取待排清單 - 此時 contestData 狀態已更新
          await fetchPendingTeams();
        } catch (err: any) {
          console.error('獲取子數據失敗:', err);
          setError('獲取子數據失敗: ' + err.message);
        }
      }, 100); // 短暫延遲確保狀態更新
      
    } catch (err: any) {
      console.error('獲取比賽資料失敗:', err);
      setError('獲取比賽資料失敗: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // 獲取子賽事列表
  const fetchSubContests = async () => {
    try {
      const { data: subContestsData, error } = await supabase
        .from('contest')
        .select('*')
        .eq('parent_contest_id', contestId)
        .order('stage_order', { ascending: true })
        .order('parallel_group', { ascending: true });
      
      if (error) throw error;
      
      // 為每個子賽事獲取隊伍數量
      const subContestsWithCounts = await Promise.all(
        (subContestsData || []).map(async (subContest) => {
          let teamCount = 0;
          
          // 總是從 contest_group_assignment 獲取實際隊伍數
          const { count } = await supabase
            .from('contest_group_assignment')
            .select('assignment_id', { count: 'exact' })
            .eq('group_contest_id', subContest.contest_id);
          teamCount = count || 0;
          
          // 不再動態更新 expected_teams，保持為原始參賽隊伍數
          console.log(`[fetchSubContests] 子賽事 ${subContest.contest_id} 保持原始參賽隊伍數: ${subContest.expected_teams}，當前隊伍數: ${teamCount}`);
          
          return {
            ...subContest,
            team_count: teamCount
          };
        })
      );
      
      setSubContests(subContestsWithCounts);
      
      // 自動展開所有階段
      const stages = [...new Set(subContestsWithCounts.map(s => s.stage_order || 1))];
      const initialExpanded: {[key: number]: boolean} = {};
      stages.forEach(stage => {
        initialExpanded[stage] = true;
      });
      setExpandedStages(initialExpanded);
      
    } catch (err: any) {
      console.error('獲取子賽事失敗:', err);
    }
  };

  // 獲取待排清單 - 使用與子賽事分配頁面相同的邏輯
  const fetchPendingTeams = async () => {
    try {
      if (!contestId) return;
      
      // 🔧 修正：重新獲取最新的賽事狀態，確保數據一致性
      const { data: latestContestData, error: contestError } = await supabase
        .from('contest')
        .select('contest_status, advancement_rules')
        .eq('contest_id', contestId)
        .single();
      
      if (contestError) {
        console.error('獲取最新賽事狀態失敗:', contestError);
        // 如果獲取失敗，使用現有的 contestData
      } else {
        // 🔧 檢查主賽事是否已結束，如果已結束則顯示最終排名
        if (latestContestData?.contest_status === 'finished' && latestContestData?.advancement_rules?.final_ranking) {
          console.log('主賽事已結束，顯示最終排名');
          const finalRanking = latestContestData.advancement_rules.final_ranking;
          
          // 將最終排名轉換為待排清單格式以便顯示
          const finalRankingTeams = finalRanking.map((team: any) => ({
            contest_team_id: team.contest_team_id,
            team_name: team.team_name,
            source: 'final_ranking',
            qualified_rank: team.final_rank,
            points: team.points,
            source_info: team.source_info || `第${team.final_rank}名`
          }));
          
          setPendingTeams(finalRankingTeams);
          
          // 🆕 同步更新本地的 contestData 狀態
          if (contestData && contestData.contest_status !== latestContestData.contest_status) {
            setContestData(prev => prev ? {
              ...prev,
              contest_status: latestContestData.contest_status,
              advancement_rules: latestContestData.advancement_rules
            } : null);
          }
          
          return;
        }
      }
      
      // 1. 獲取主賽事的所有隊伍
      const { data: allTeams, error: teamsError } = await supabase
        .from('contest_team')
        .select('contest_team_id, team_name')
        .eq('contest_id', contestId);
      
      if (teamsError) throw teamsError;
      
      console.log('主賽事所有隊伍:', allTeams);
      
      // 2. 獲取所有子賽事的 contest_id
      const { data: allSubContests, error: subContestsError } = await supabase
        .from('contest')
        .select('contest_id')
        .eq('parent_contest_id', contestId);
      
      if (subContestsError) throw subContestsError;
      
      const subContestIds = allSubContests?.map(s => s.contest_id) || [];
      console.log('所有子賽事ID:', subContestIds);
      
      // 3. 獲取所有已分配到子賽事的隊伍（使用 contest_group_assignment 表）
      let allAssignedTeamsData: any[] = [];
      if (subContestIds.length > 0) {
        const { data: assignmentsData, error: assignmentError } = await supabase
          .from('contest_group_assignment')
          .select('contest_team_id, team_name, group_contest_id')
          .in('group_contest_id', subContestIds);
        
        if (assignmentError) throw assignmentError;
        allAssignedTeamsData = assignmentsData || [];
      }
      
      console.log('所有子賽事分配記錄:', allAssignedTeamsData);
      
      // 4. 找出所有已被分配到任何子賽事的隊伍ID
      const allAssignedTeamIds = new Set(allAssignedTeamsData.map((t: any) => t.contest_team_id));
      
      // 5. 計算待排清單 = 主賽事所有隊伍 - 所有已被分配的隊伍
      const pendingTeamsWithSource = (allTeams || [])
        .filter(team => !allAssignedTeamIds.has(team.contest_team_id))
        .map(team => ({
          contest_team_id: team.contest_team_id,
          team_name: team.team_name,
          source: 'main'
        }));
      
      console.log('待排清單計算結果:', {
        總隊伍數: allTeams?.length || 0,
        已分配隊伍數: allAssignedTeamIds.size,
        待排清單數: pendingTeamsWithSource.length,
        待排清單詳情: pendingTeamsWithSource
      });
      
      setPendingTeams(pendingTeamsWithSource);
    } catch (err: any) {
      console.error('獲取待排清單失敗:', err);
    }
  };

  // 創建子賽事
  const handleCreateSubContest = async () => {
    try {
      if (!newSubContest.contest_name.trim()) {
        setError('請輸入子賽事名稱');
        return;
      }
      
      if (newSubContest.advancement_count < 1) {
        setError('晉級隊伍數量必須大於0');
        return;
      }
      
      // 計算階段順序和平行組
      let targetStageOrder = newSubContest.stage_order;
      let targetParallelGroup = newSubContest.parallel_group || null;
      
      // 如果沒有指定階段，則創建新階段
      if (!targetStageOrder) {
        targetStageOrder = Math.max(...subContests.map(s => s.stage_order || 0), 0) + 1;
      }
      
      // 從父賽事繼承必要設定
      const { data: parentContest, error: parentError } = await supabase
        .from('contest')
        .select('total_points, points_config, table_count, players_per_team, expected_teams')
        .eq('contest_id', contestId)
        .single();
      
      if (parentError) throw parentError;
      
      const subContestData = {
        contest_name: newSubContest.contest_name,
        created_by: user.name || user.member_name || 'Unknown User',
        team_name: user.team_name || 'Unknown Team',
        contest_type: 'league_child',
        parent_contest_id: parseInt(contestId!),
        match_mode: newSubContest.match_mode,
        contest_status: 'WaitMatchForm',
        stage_order: targetStageOrder,
        parallel_group: targetParallelGroup,
        rule_text: newSubContest.rule_text || `${newSubContest.match_mode === 'round_robin' ? '循環賽' : '淘汰賽'}，晉級${newSubContest.advancement_count}隊`,
        // 從父賽事繼承的設定
        total_points: parentContest.total_points || 5,
        points_config: parentContest.points_config,
        table_count: parentContest.table_count || 1,
        players_per_team: parentContest.players_per_team || 2,
        expected_teams: pendingTeams.length, // 預設為當前待排清單的隊伍數
        // 晉級規則
        advancement_rules: {
          advancement_count: newSubContest.advancement_count,
          source_teams: pendingTeams.map(team => ({
            contest_team_id: team.contest_team_id,
            team_name: team.team_name,
            source: team.source
          })),
          expected_output: newSubContest.advancement_count
        }
      };
      
      const { data, error } = await supabase
        .from('contest')
        .insert([subContestData])
        .select()
        .single();
      
      if (error) throw error;
      
      setSuccessMessage('子賽事創建成功！');
      setShowCreateSubContest(false);
      setNewSubContest({
        contest_name: '',
        match_mode: 'elimination',
        advancement_count: 2,
        rule_text: '',
        stage_order: 1,
        parallel_group: ''
      });
      
      // 重新獲取子賽事列表和待排清單
      await fetchSubContests();
      // 立即刷新待排清單，然後再延遲刷新一次確保數據同步
      await fetchPendingTeams();
      setTimeout(async () => {
        await fetchPendingTeams();
        console.log('子賽事完成後二次刷新待排清單完成');
      }, 2000);
      
    } catch (err: any) {
      console.error('創建子賽事失敗:', err);
      setError('創建子賽事失敗: ' + err.message);
    }
  };

  // 分配隊伍到子賽事
  const handleAssignTeamsToSubContest = async (subContestId: string, teamIds: number[]) => {
    try {
      // 創建分組分配記錄
      const assignments = teamIds.map(teamId => ({
        group_contest_id: subContestId,
        contest_team_id: teamId,
        assigned_at: new Date().toISOString()
      }));
      
      const { error } = await supabase
        .from('contest_group_assignment')
        .insert(assignments);
      
      if (error) throw error;
      
      // 獲取子賽事分配完成後的總隊伍數
      const { count: totalTeamCount, error: countError } = await supabase
        .from('contest_group_assignment')
        .select('assignment_id', { count: 'exact' })
        .eq('group_contest_id', subContestId);
      
      if (countError) throw countError;
      
      // 更新子賽事的 expected_teams 欄位
      const { error: updateSubContestError } = await supabase
        .from('contest')
        .update({ expected_teams: totalTeamCount || 0 })
        .eq('contest_id', subContestId);
      
      if (updateSubContestError) {
        console.error('更新子賽事 expected_teams 失敗:', updateSubContestError);
      } else {
        console.log(`成功更新子賽事 ${subContestId} 的 expected_teams 為:`, totalTeamCount);
      }
      
      // 從待排清單中移除已分配的隊伍
      const updatedPendingTeams = pendingTeams.filter(
        team => !teamIds.includes(team.contest_team_id)
      );
      
      // 更新主賽事的 bracket_structure
      if (contestData) {
        const updatedBracketStructure = {
          ...contestData.bracket_structure,
          pending_teams: updatedPendingTeams.map(t => t.contest_team_id)
        };
        
        await supabase
          .from('contest')
          .update({ bracket_structure: updatedBracketStructure })
          .eq('contest_id', contestId);
      }
      
      // 🆕 同步主賽事狀態 - 隊伍分配可能影響主賽事狀態
      await syncMainContestStatus(contestId!);
      
      setPendingTeams(updatedPendingTeams);
      setSuccessMessage('隊伍分配成功！主賽事狀態已同步');
      
      // 重新獲取子賽事資料
      await fetchSubContests();
      
    } catch (err: any) {
      console.error('分配隊伍失敗:', err);
      setError('分配隊伍失敗: ' + err.message);
    }
  };

  // 刪除子賽事
  const handleDeleteSubContest = async (subContestId: string) => {
    try {
      const subContest = subContests.find(s => s.contest_id === subContestId);
      if (!subContest) {
        setError('找不到指定的子賽事');
        return;
      }

      // 確認刪除
      const confirmDelete = window.confirm(
        `確定要刪除子賽事「${subContest.contest_name}」嗎？\n\n` +
        `注意：此操作將會：\n` +
        `• 刪除子賽事記錄\n` +
        `• 移除所有隊伍分配記錄\n` +
        `• 此操作無法復原\n\n` +
        `只有在子賽事尚未產生對戰表時才能刪除。`
      );

      if (!confirmDelete) return;

      // 修改狀態檢查：允許刪除 WaitMatchForm 和 recruiting 狀態的子賽事
      const allowedStatuses = ['WaitMatchForm', 'recruiting'];
      if (!allowedStatuses.includes(subContest.contest_status)) {
        setError(`只能刪除尚未產生對戰表的子賽事（允許狀態：${allowedStatuses.join(', ')}），當前狀態：${subContest.contest_status}`);
        return;
      }

      // 檢查是否有比賽記錄
      const { data: matchRecords, error: matchCheckError } = await supabase
        .from('contest_match')
        .select('match_id')
        .eq('contest_id', subContestId)
        .limit(1);

      if (matchCheckError) {
        console.error('檢查比賽記錄失敗:', matchCheckError);
        throw new Error('檢查比賽記錄失敗');
      }

      if (matchRecords && matchRecords.length > 0) {
        setError('此子賽事已有比賽記錄，無法刪除');
        return;
      }

      // 檢查是否有比賽詳情記錄
      const { data: matchDetailRecords, error: matchDetailCheckError } = await supabase
        .from('contest_match_detail')
        .select('match_detail_id')
        .eq('contest_id', subContestId)
        .limit(1);

      if (matchDetailCheckError) {
        console.error('檢查比賽詳情記錄失敗:', matchDetailCheckError);
        throw new Error('檢查比賽詳情記錄失敗');
      }

      if (matchDetailRecords && matchDetailRecords.length > 0) {
        setError('此子賽事已有比賽詳情記錄，無法刪除');
        return;
      }

      console.log(`開始刪除子賽事 ${subContestId}，當前狀態：${subContest.contest_status}`);

      // 1. 先刪除隊伍分配記錄
      const { data: deletedAssignments, error: deleteAssignmentsError } = await supabase
        .from('contest_group_assignment')
        .delete()
        .eq('group_contest_id', subContestId)
        .select();

      if (deleteAssignmentsError) {
        console.error('刪除隊伍分配記錄失敗:', deleteAssignmentsError);
        throw new Error('刪除隊伍分配記錄失敗');
      }

      console.log(`成功刪除 ${deletedAssignments?.length || 0} 筆隊伍分配記錄`);

      // 2. 刪除子賽事記錄
      const { data: deletedContest, error: deleteContestError } = await supabase
        .from('contest')
        .delete()
        .eq('contest_id', subContestId)
        .select();

      if (deleteContestError) {
        console.error('刪除子賽事失敗:', deleteContestError);
        throw new Error('刪除子賽事失敗');
      }

      console.log(`成功刪除子賽事記錄:`, deletedContest);

      // 🆕 同步主賽事狀態 - 刪除子賽事可能影響主賽事狀態
      await syncMainContestStatus(contestId!);

      setSuccessMessage(`子賽事「${subContest.contest_name}」已成功刪除，已釋放 ${deletedAssignments?.length || 0} 支隊伍回待排清單，主賽事狀態已同步`);

      // 重新獲取資料
      await fetchSubContests();
      await fetchPendingTeams(); // 重新獲取待排清單，因為分配的隊伍已被釋放

    } catch (err: any) {
      console.error('刪除子賽事失敗:', err);
      setError('刪除子賽事失敗: ' + err.message);
    }
  };

  // 完成子賽事並處理晉級（使用共用函數）
  const handleCompleteSubContest = async (subContestId: string) => {
    try {
      const subContest = subContests.find(s => s.contest_id === subContestId);
      if (!subContest) return;
      
      console.log(`開始完成子賽事: ${subContestId}`);
      
      // 使用共用函數處理結束賽事邏輯
      const success = await finishContest(subContestId);
      
      if (success) {
        // 獲取晉級隊伍資訊用於顯示訊息
        const { data: contestData, error: contestError } = await supabase
          .from('contest')
          .select('advancement_rules')
          .eq('contest_id', subContestId)
          .single();
        
        if (!contestError && contestData?.advancement_rules?.qualified_teams) {
          const qualifiedTeams = contestData.advancement_rules.qualified_teams;
          const qualifiedTeamNames = qualifiedTeams.map((team: any) => team.team_name).join(', ');
          setSuccessMessage(`子賽事完成！${qualifiedTeams.length}支隊伍晉級到待排清單。晉級隊伍：${qualifiedTeamNames}`);
        } else {
          setSuccessMessage('子賽事已成功完成！');
        }
        
        // 🆕 同步主賽事狀態 - 子賽事完成可能影響主賽事狀態
        await syncMainContestStatus(contestId!);
        
        // 重新獲取子賽事列表和待排清單
        await fetchSubContests();
        // 立即刷新待排清單，然後再延遲刷新一次確保數據同步
        await fetchPendingTeams();
        setTimeout(async () => {
          await fetchPendingTeams();
          console.log('子賽事完成後二次刷新待排清單完成');
        }, 2000);
      } else {
        throw new Error('結束子賽事失敗');
      }
      
    } catch (err: any) {
      console.error('完成子賽事失敗:', err);
      setError('完成子賽事失敗: ' + err.message);
    }
  };

  // 處理主賽事結束
  const handleFinishMainContest = async () => {
    try {
      console.log('🏆 開始結束混合賽主賽事...');
      console.log('當前待排清單:', pendingTeams);

      // 🆕 步驟1：計算最終排名
      // 從最後階段的淘汰賽結果獲取正確的排名，而不是簡單按待排清單順序
      const finalRanking = await calculateFinalRankingFromLastStage();

      console.log('🏅 計算出的最終排名:', finalRanking);

      // 🆕 步驟2：更新主賽事的 advancement_rules
      const updatedAdvancementRules = {
        ...contestData?.advancement_rules,
        qualified_teams: finalRanking,
        final_ranking: finalRanking,
        total_teams: contestData?.expected_teams || 0,
        completed_at: new Date().toISOString()
      };

      console.log('📝 準備更新的 advancement_rules:', updatedAdvancementRules);

      // 🆕 步驟3：更新主賽事狀態和排名資料
      const { error: updateError } = await supabase
        .from('contest')
        .update({ 
          contest_status: 'finished',
          advancement_rules: updatedAdvancementRules
        })
        .eq('contest_id', contestId);

      if (updateError) throw updateError;

      // 🆕 步驟4：清理 contest_group_assignment 表
      // 將所有相關記錄標記為最終狀態，而不是刪除
      const { error: cleanupError } = await supabase
        .from('contest_group_assignment')
        .update({ 
          status: 'final_completed',
          updated_at: new Date().toISOString()
        })
        .eq('main_contest_id', parseInt(contestId!));

      if (cleanupError) {
        console.warn('清理 contest_group_assignment 表失敗:', cleanupError);
        // 不阻止主流程，只記錄警告
      } else {
        console.log('✅ 成功清理 contest_group_assignment 表');
      }

      // 🆕 步驟5：更新本地狀態
      setContestData(prev => prev ? { 
        ...prev, 
        contest_status: 'finished',
        advancement_rules: updatedAdvancementRules
      } : null);
      
      setShowFinishPrompt(false);

      // 🆕 步驟6：顯示詳細的成功訊息
      const rankingText = finalRanking.slice(0, 3).map((team, index) => {
        const medals = ['🏆', '🥈', '🥉'];
        const titles = ['冠軍', '亞軍', '季軍'];
        return `${medals[index]} ${titles[index]}: ${team.team_name}`;
      }).join(' | ');

      setSuccessMessage(`🎉 混合賽已成功結束！最終排名：${rankingText}`);
      
      console.log('🎊 混合賽主賽事結束完成');
      console.log('📊 最終排名:', finalRanking);

      // 🆕 步驟7：重新獲取資料以更新顯示
      await fetchPendingTeams(); // 這會更新待排清單的顯示模式

    } catch (error) {
      console.error('結束主賽事失敗:', error);
      setError('結束主賽事失敗: ' + (error as Error).message);
    }
  };

  // 🆕 從最後階段的子賽事結果計算正確的最終排名
  // 🔧 修正：確保主賽事的最終排名與最後一場子賽事的晉級隊伍邏輯完全一致
  const calculateFinalRankingFromLastStage = async () => {
    try {
      console.log('🔍 ===== 開始混合賽最終排名計算 =====');
      console.log('當前所有子賽事:', subContests);
      
      // 1. 找到最後階段的子賽事
      const maxStage = Math.max(...subContests.map(s => s.stage_order || 1));
      const lastStageSubContests = subContests.filter(s => s.stage_order === maxStage);
      
      console.log(`📊 最後階段 (第${maxStage}階段) 的子賽事數量: ${lastStageSubContests.length}`);
      console.log('最後階段子賽事詳情:', lastStageSubContests.map(s => ({
        contest_id: s.contest_id,
        contest_name: s.contest_name,
        contest_status: s.contest_status,
        parallel_group: s.parallel_group
      })));
      
      if (lastStageSubContests.length === 0) {
        console.warn('⚠️ 找不到最後階段的子賽事，使用待排清單順序');
        return pendingTeams.map((team, index) => ({
          contest_team_id: team.contest_team_id,
          team_name: team.team_name,
          final_rank: index + 1,
          points: 100 - index * 10,
          source_info: '待排清單順序'
        }));
      }
      
      // 2. 收集所有最後階段子賽事的 qualified_teams
      const allFinalRankings: any[] = [];
      
      for (const subContest of lastStageSubContests) {
        console.log(`\n🔍 檢查子賽事 ${subContest.contest_id} (${subContest.contest_name}) 的晉級結果...`);
        
        const { data: subContestData, error } = await supabase
          .from('contest')
          .select('advancement_rules')
          .eq('contest_id', subContest.contest_id)
          .single();
        
        console.log(`子賽事 ${subContest.contest_id} 查詢結果:`, { error, data: subContestData });
        
        if (!error && subContestData?.advancement_rules?.qualified_teams) {
          const qualifiedTeams = subContestData.advancement_rules.qualified_teams;
          console.log(`✅ 子賽事 ${subContest.contest_id} 的原始晉級隊伍:`, qualifiedTeams);
          
          // 🔧 關鍵修正：完全保持子賽事的排名順序和分數，不做任何修改
          qualifiedTeams.forEach((team: any, index: number) => {
            console.log(`保持原始排名 ${index + 1}: ${team.team_name}, 原始分數: ${team.points}`);
            
            const teamRankingInfo = {
              contest_team_id: team.contest_team_id,
              team_name: team.team_name,
              points: team.points || (100 - index * 10), // 保持原始分數，如果沒有則用預設值
              source_contest_id: subContest.contest_id,
              source_contest_name: subContest.contest_name,
              source_rank: index + 1, // 在該子賽事中的排名
              parallel_group: subContest.parallel_group || 'main',
              // 🆕 新增：記錄這是來自子賽事的原始排名
              is_original_ranking: true,
              original_index: index // 保持原始索引順序
            };
            
            console.log(`  -> 保持原始排名信息:`, teamRankingInfo);
            allFinalRankings.push(teamRankingInfo);
          });
        } else {
          console.warn(`⚠️ 子賽事 ${subContest.contest_id} 沒有晉級結果`, { error, advancement_rules: subContestData?.advancement_rules });
        }
      }
      
      console.log('\n📋 收集到的所有最後階段排名:');
      allFinalRankings.forEach((team, index) => {
        console.log(`  ${index + 1}. ${team.team_name} - 來源: ${team.source_contest_name} 第${team.source_rank}名, 分數: ${team.points}`);
      });
      
      // 3. 🔧 關鍵修正：如果只有一個子賽事（決賽），完全保持其排名順序
      if (lastStageSubContests.length === 1) {
        console.log('\n🏆 只有一個決賽子賽事，完全保持其排名順序');
        const finalRanking = allFinalRankings.map((team, index) => ({
          contest_team_id: team.contest_team_id,
          team_name: team.team_name,
          final_rank: index + 1, // 保持原始順序
          points: team.points,
          source_info: `${team.source_contest_name} 第${team.source_rank}名`
        }));
        
        console.log('🏅 單一決賽的最終排名（保持原始順序）:');
        finalRanking.forEach((team, index) => {
          console.log(`  第${team.final_rank}名: ${team.team_name} (${team.points}分) - ${team.source_info}`);
        });
        
        return finalRanking;
      }
      
      // 4. 🔧 修正：多個平行組時，按照預定規則合併，不重新排序
      console.log('\n🔄 有多個平行組，按照預定規則合併排名...');
      
      // 按照平行組和原始索引排序，保持每個子賽事內部的排名順序
      allFinalRankings.sort((a, b) => {
        // 首先按照在各自子賽事中的排名排序（第1名優先於第2名）
        if (a.source_rank !== b.source_rank) {
          return a.source_rank - b.source_rank;
        }
        
        // 相同排名時，按照平行組排序（保持一致性）
        if (a.parallel_group !== b.parallel_group) {
          return (a.parallel_group || '').localeCompare(b.parallel_group || '');
        }
        
        // 最後按照原始索引排序（保持子賽事內部順序）
        return a.original_index - b.original_index;
      });
      
      console.log('\n合併後的隊伍列表（保持子賽事排名邏輯）:');
      allFinalRankings.forEach((team, index) => {
        console.log(`  ${index + 1}. ${team.team_name} - 組別: ${team.parallel_group}, 組內排名: ${team.source_rank}, 分數: ${team.points}`);
      });
      
      // 5. 🔧 修正：生成最終排名，完全按照合併後的順序
      const finalRanking = allFinalRankings.map((team, index) => ({
        contest_team_id: team.contest_team_id,
        team_name: team.team_name,
        final_rank: index + 1, // 按照合併後的順序分配排名
        points: team.points,
        source_info: `${team.source_contest_name} 第${team.source_rank}名`
      }));
      
      console.log('\n🏅 ===== 混合賽最終排名計算完成 =====');
      console.log('最終排名結果（保持子賽事邏輯）:');
      finalRanking.forEach((team, index) => {
        console.log(`  🏆 第${team.final_rank}名: ${team.team_name} (${team.points}分) - ${team.source_info}`);
      });
      console.log('=====================================\n');
      
      return finalRanking;
      
    } catch (error) {
      console.error('❌ 計算最終排名失敗:', error);
      console.error('錯誤堆疊:', error.stack);
      // 發生錯誤時，回退到待排清單順序
      console.log('🔄 回退到待排清單順序');
      return pendingTeams.map((team, index) => ({
        contest_team_id: team.contest_team_id,
        team_name: team.team_name,
        final_rank: index + 1,
        points: 100 - index * 10,
        source_info: '系統回退排序'
      }));
    }
  };

  // 取消結束主賽事
  const handleCancelFinish = () => {
    setShowFinishPrompt(false);
  };

  // 產生循環賽對戰單
  const handleGenerateRoundRobinMatches = async (subContestId: string) => {
    try {
      console.log('開始為子賽事產生循環賽對戰單:', subContestId);

      // 1. 獲取參賽隊伍
      const { data: teams, error: teamsError } = await supabase
        .from('contest_group_assignment')
        .select('contest_team_id, team_name')
        .eq('group_contest_id', subContestId);

      if (teamsError) throw teamsError;
      if (!teams || teams.length < 2) {
        setError('至少需要2支隊伍才能產生對戰單');
        return;
      }

      console.log('參賽隊伍:', teams);

      // 2. 產生循環賽對戰組合
      const matches = [];
      for (let i = 0; i < teams.length; i++) {
        for (let j = i + 1; j < teams.length; j++) {
          matches.push({
            contest_id: parseInt(subContestId),
            team1_id: teams[i].contest_team_id,
            team2_id: teams[j].contest_team_id,
            round: 1, // 循環賽都是第1輪
            match_date: new Date().toISOString(),
            created_at: new Date().toISOString()
          });
        }
      }

      console.log('產生的對戰組合:', matches);

      // 3. 插入對戰記錄到資料庫
      const { data: insertedMatches, error: matchError } = await supabase
        .from('contest_match')
        .insert(matches)
        .select('match_id, team1_id, team2_id');

      if (matchError) throw matchError;
      if (!insertedMatches) throw new Error('插入對戰記錄失敗');

      console.log('插入的對戰記錄:', insertedMatches);

      // 4. 獲取子賽事的設定資訊
      const { data: subContestData, error: subContestError } = await supabase
        .from('contest')
        .select('total_points, points_config')
        .eq('contest_id', subContestId)
        .single();

      if (subContestError) throw subContestError;

      // 如果子賽事沒有設定，從父賽事獲取
      let totalPoints = subContestData.total_points;
      let pointsConfig = subContestData.points_config;

      if (!totalPoints || totalPoints <= 0) {
        const { data: parentData, error: parentError } = await supabase
          .from('contest')
          .select('total_points, points_config')
          .eq('contest_id', contestId)
          .single();
        
        if (!parentError && parentData) {
          totalPoints = parentData.total_points;
          pointsConfig = parentData.points_config;
        }
      }

      // 確保 total_points 至少為 1
      totalPoints = totalPoints && totalPoints > 0 ? totalPoints : 5;

      // 5. 為每場比賽創建對戰詳細記錄
      const matchDetails = [];
      for (const match of insertedMatches) {
        // 為每場比賽創建多個小局
        for (let sequence = 1; sequence <= totalPoints; sequence++) {
          matchDetails.push({
            match_id: match.match_id,
            contest_id: parseInt(subContestId),
            team1_member_ids: [],
            team2_member_ids: [],
            winner_team_id: null,
            score: null,
            sequence: sequence,
            match_type: pointsConfig && pointsConfig[sequence - 1] 
              ? pointsConfig[sequence - 1].type 
              : '雙打',
            table_no: null,
            judge_id: null
          });
        }
      }

      console.log('準備插入的對戰詳細記錄:', matchDetails);

      const { error: detailError } = await supabase
        .from('contest_match_detail')
        .insert(matchDetails);

      if (detailError) throw detailError;

      // 6. 更新子賽事狀態為進行中
      const { error: updateError } = await supabase
        .from('contest')
        .update({ contest_status: 'ongoing' })
        .eq('contest_id', subContestId);

      if (updateError) throw updateError;

      // 🆕 同步主賽事狀態 - 不管當前狀態，根據實際條件更新
      await syncMainContestStatus(contestId!);

      // 7. 重新獲取子賽事資料
      await fetchSubContests();
      
      // 使用 alert 顯示成功訊息，與賽事控制台保持一致
      alert(`✅ 成功為循環賽產生 ${matches.length} 場對戰，每場 ${totalPoints} 局！`);
      setSuccessMessage(`成功為循環賽產生 ${matches.length} 場對戰，每場 ${totalPoints} 局！`);
      console.log('循環賽對戰單產生完成');

    } catch (error: any) {
      console.error('產生循環賽對戰單失敗:', error);
      setError('產生對戰單失敗: ' + error.message);
    }
  };

  // 渲染待排清單
  const renderPendingTeams = () => {
    return (
      <div className="pending-teams-panel" style={{
        backgroundColor: '#fff',
        borderRadius: '8px',
        padding: '20px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        marginBottom: '20px'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ 
            margin: '0', 
            fontSize: '18px',
            color: '#1e40af',
            borderBottom: '2px solid #3b82f6',
            paddingBottom: '8px'
          }}>
            {contestData?.contest_status === 'finished' ? '最終排名' : '待排清單'} ({pendingTeams.length} 支隊伍)
          </h3>
          <button
            onClick={async () => {
              console.log('手動刷新待排清單...');
              await fetchPendingTeams();
              console.log('待排清單刷新完成');
            }}
            style={{
              padding: '6px 12px',
              backgroundColor: '#10b981',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: 'bold'
            }}
          >
            🔄 刷新
          </button>
        </div>
        
        {pendingTeams.length === 0 ? (
          <div style={{ 
            textAlign: 'center', 
            color: '#666', 
            padding: '20px',
            backgroundColor: '#f9f9f9',
            borderRadius: '6px'
          }}>
            目前沒有待分配的隊伍
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' }}>
            {pendingTeams.map((team, index) => {
              // 🆕 改進的排名顯示邏輯
              const isFinished = contestData?.contest_status === 'finished';
              const medals = ['🏆', '🥈', '🥉'];
              const titles = ['冠軍', '亞軍', '季軍'];
              const rankColors = ['#ffd700', '#c0c0c0', '#cd7f32', '#4caf50']; // 金、銀、銅、綠
              
              return (
                <div key={team.contest_team_id} style={{
                  padding: '12px',
                  border: isFinished ? `3px solid ${rankColors[Math.min(index, 3)]}` : '2px solid #e0e0e0',
                  borderRadius: '8px',
                  backgroundColor: isFinished ? (index === 0 ? '#fffbf0' : index === 1 ? '#f8f9fa' : index === 2 ? '#fdf6e3' : '#f0f9ff') : '#f8f9fa',
                  transition: 'all 0.2s ease',
                  boxShadow: isFinished ? '0 4px 8px rgba(0,0,0,0.1)' : 'none'
                }}>
                  <div style={{ fontWeight: 'bold', marginBottom: '4px', fontSize: isFinished ? '16px' : '14px' }}>
                    {isFinished ? (
                      <>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '20px' }}>
                            {index < 3 ? medals[index] : `🏅`}
                          </span>
                          <div>
                            <div style={{ color: rankColors[Math.min(index, 3)], fontWeight: 'bold' }}>
                              {index < 3 ? titles[index] : `第${index + 1}名`}
                            </div>
                            <div style={{ color: '#333', fontSize: '14px' }}>
                              {team.team_name}
                            </div>
                          </div>
                        </div>
                      </>
                    ) : (
                      team.team_name
                    )}
                  </div>
                  
                  {!isFinished && (
                    <div style={{ fontSize: '12px', color: '#666' }}>
                      來源: {team.source === 'main' ? '主賽事' : team.source === 'qualified' ? '子賽事晉級' : `子賽事 #${team.source}`}
                    </div>
                  )}
                  
                  {isFinished && (
                    <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
                      🏆 混合賽最終排名
                    </div>
                  )}
                  
                  {team.qualified_rank && !isFinished && (
                    <div style={{ fontSize: '12px', color: '#4caf50' }}>
                      排名: 第{team.qualified_rank}名
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  // 按階段分組子賽事
  const groupSubContestsByStage = () => {
    const grouped: {[key: number]: SubContestData[]} = {};
    subContests.forEach(subContest => {
      const stage = subContest.stage_order || 1;
      if (!grouped[stage]) {
        grouped[stage] = [];
      }
      grouped[stage].push(subContest);
    });
    return grouped;
  };

  // 切換階段展開狀態
  const toggleStageExpansion = (stageOrder: number) => {
    setExpandedStages(prev => ({
      ...prev,
      [stageOrder]: !prev[stageOrder]
    }));
  };

  // 創建平行組
  const handleCreateParallelGroup = (stageOrder: number) => {
    const existingGroups = subContests
      .filter(s => s.stage_order === stageOrder)
      .map(s => s.parallel_group || '')
      .filter(g => g !== '');
    
    // 生成下一個組別名稱 (A, B, C, D...)
    // 如果沒有現有組別，從A開始；如果有，則從下一個字母開始
    const nextGroupLetter = String.fromCharCode(65 + existingGroups.length); // A=65
    const matchModeText = 'elimination' === 'round_robin' ? '循環賽' : '淘汰賽';
    const contestName = contestData ? `${contestData.contest_name}-第${stageOrder}階段-${matchModeText}-${nextGroupLetter}組` : `階段${stageOrder}-${nextGroupLetter}組`;
    
    setNewSubContest({
      contest_name: contestName,
      match_mode: 'elimination',
      advancement_count: 2,
      rule_text: '',
      stage_order: stageOrder,
      parallel_group: nextGroupLetter
    });
    setShowCreateSubContest(true);
  };

  // 渲染子賽事列表
  const renderSubContests = () => {
    const groupedSubContests = groupSubContestsByStage();
    const stages = Object.keys(groupedSubContests).map(Number).sort((a, b) => a - b);

    return (
      <div className="sub-contests-panel" style={{
        backgroundColor: '#fff',
        borderRadius: '8px',
        padding: '20px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        marginBottom: '20px'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ 
            margin: '0', 
            fontSize: '18px',
            color: '#1e40af',
            borderBottom: '2px solid #3b82f6',
            paddingBottom: '8px'
          }}>
            子賽事階段 ({stages.length} 個階段，{subContests.length} 個子賽事)
          </h3>
          <button
            onClick={() => {
              const nextStage = Math.max(...stages, 0) + 1;
              const matchModeText = 'elimination' === 'round_robin' ? '循環賽' : '淘汰賽';
              const contestName = contestData ? `${contestData.contest_name}-第${nextStage}階段-${matchModeText}-A組` : `階段${nextStage}`;
              
              setNewSubContest({
                contest_name: contestName,
                match_mode: 'elimination',
                advancement_count: 2,
                rule_text: '',
                stage_order: nextStage,
                parallel_group: 'A'
              });
              setShowCreateSubContest(true);
            }}
            style={{
              padding: '8px 16px',
              backgroundColor: '#10b981',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 'bold'
            }}
          >
            + 新增階段
          </button>
        </div>
        
        {stages.length === 0 ? (
          <div style={{ 
            textAlign: 'center', 
            color: '#666', 
            padding: '20px',
            backgroundColor: '#f9f9f9',
            borderRadius: '6px'
          }}>
            尚未創建任何子賽事階段
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {stages.map(stageOrder => {
              const stageSubContests = groupedSubContests[stageOrder];
              const isExpanded = expandedStages[stageOrder];
              const completedCount = stageSubContests.filter(s => s.contest_status === 'finished').length;
              const totalCount = stageSubContests.length;
              
              return (
                <div key={stageOrder} style={{
                  border: '2px solid #e0e0e0',
                  borderRadius: '12px',
                  backgroundColor: '#f8f9fa',
                  overflow: 'hidden'
                }}>
                  {/* 階段標題區 */}
                  <div 
                    style={{
                      padding: '16px',
                      backgroundColor: '#e0f2fe',
                      borderBottom: isExpanded ? '1px solid #e0e0e0' : 'none',
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}
                    onClick={() => toggleStageExpansion(stageOrder)}
                  >
                    <div style={{ flex: 1 }}>
                      <h4 style={{ margin: '0 0 4px 0', fontSize: '18px', fontWeight: 'bold', color: '#0369a1' }}>
                        {isExpanded ? '▼' : '▶'} 階段 {stageOrder}
                        {stageSubContests.length > 1 && ` (${stageSubContests.length}個平行組)`}
                      </h4>
                      <div style={{ fontSize: '14px', color: '#0369a1' }}>
                        進度: {completedCount}/{totalCount} 完成
                        {totalCount > 1 && ` | 平行組: ${stageSubContests.map(s => s.parallel_group || '主').join(', ')}`}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCreateParallelGroup(stageOrder);
                        }}
                        style={{
                          padding: '6px 12px',
                          backgroundColor: '#8b5cf6',
                          color: 'white',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '12px'
                        }}
                      >
                        + 平行組
                      </button>
                    </div>
                  </div>

                  {/* 階段內容區 */}
                  {isExpanded && (
                    <div style={{ padding: '16px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {stageSubContests.map(subContest => (
                          <div key={subContest.contest_id} style={{
                            padding: '12px',
                            border: '1px solid #d1d5db',
                            borderRadius: '8px',
                            backgroundColor: 'white'
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                              <div style={{ flex: 1 }}>
                                <h5 style={{ margin: '0 0 6px 0', fontSize: '16px', fontWeight: 'bold' }}>
                                  {subContest.parallel_group ? `${subContest.parallel_group}組: ` : ''}{subContest.contest_name}
                                </h5>
                                <div style={{ fontSize: '14px', color: '#666', marginBottom: '4px' }}>
                                  賽制: {subContest.match_mode === 'round_robin' ? '循環賽' : '淘汰賽'} | 
                                  隊伍數: {subContest.expected_teams || 0} | 
                                  晉級數: {subContest.advancement_rules?.advancement_count || 0}
                                </div>
                                <div style={{ fontSize: '13px', color: '#888' }}>
                                  {(() => {
                                    const getStatusDisplay = (status: string, teamCount: number, matchMode: string) => {
                                      switch (status) {
                                        case 'WaitMatchForm':
                                          if (teamCount === 0) {
                                            return { text: '等待分配隊伍', color: '#f59e0b', nextStep: '請點擊「分配隊伍」按鈕' };
                                          } else if (matchMode === 'round_robin') {
                                            return { text: '已分配隊伍，等待產生對戰單', color: '#3b82f6', nextStep: '請點擊「產生對戰單」按鈕' };
                                          } else {
                                            return { text: '已分配隊伍，等待產生賽程', color: '#3b82f6', nextStep: '請到賽事控制台產生賽程' };
                                          }
                                        case 'ongoing':
                                          return { text: '比賽進行中', color: '#10b981', nextStep: '比賽完成後點擊「完成賽事」' };
                                        case 'finished':
                                          return { text: '比賽已完成', color: '#6b7280', nextStep: '晉級隊伍已回到待排清單' };
                                        case 'recruiting':
                                          return { text: '招募隊伍中', color: '#8b5cf6', nextStep: '請管理隊伍報名' };
                                        default:
                                          return { text: status, color: '#888', nextStep: '' };
                                      }
                                    };
                                    
                                    const statusInfo = getStatusDisplay(subContest.contest_status, subContest.team_count || 0, subContest.match_mode);
                                    
                                    return (
                                      <div>
                                        <span style={{ color: statusInfo.color, fontWeight: 'bold' }}>
                                          狀態: {statusInfo.text}
                                        </span>
                                        {statusInfo.nextStep && (
                                          <div style={{ fontSize: '12px', color: '#666', marginTop: '2px', fontStyle: 'italic' }}>
                                            💡 {statusInfo.nextStep}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })()}
                                </div>
                              </div>
                              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                {subContest.team_count && subContest.team_count > 0 && (
                                  <button
                                    onClick={() => toggleTeamsList(subContest.contest_id)}
                                    style={{
                                      padding: '4px 8px',
                                      backgroundColor: '#8b5cf6',
                                      color: 'white',
                                      border: 'none',
                                      borderRadius: '3px',
                                      cursor: 'pointer',
                                      fontSize: '13px'
                                    }}
                                  >
                                    {showTeamsList[subContest.contest_id] ? '隱藏隊伍' : '查看隊伍'}
                                  </button>
                                )}
                                {subContest.contest_status === 'recruiting' && (
                                  <button
                                    onClick={() => navigate(`/contest/${subContest.contest_id}/manage-teams`)}
                                    style={{
                                      padding: '4px 8px',
                                      backgroundColor: '#3b82f6',
                                      color: 'white',
                                      border: 'none',
                                      borderRadius: '3px',
                                      cursor: 'pointer',
                                      fontSize: '13px'
                                    }}
                                  >
                                    管理隊伍
                                  </button>
                                )}
                                {subContest.contest_status === 'ongoing' && (
                                  <button
                                    onClick={() => handleCompleteSubContest(subContest.contest_id)}
                                    style={{
                                      padding: '4px 8px',
                                      backgroundColor: '#10b981',
                                      color: 'white',
                                      border: 'none',
                                      borderRadius: '3px',
                                      cursor: 'pointer',
                                      fontSize: '13px'
                                    }}
                                  >
                                    完成賽事
                                  </button>
                                )}
                                
                                {/* 分配隊伍按鈕 - 所有賽制都需要先分配隊伍 */}
                                {subContest.contest_status === 'WaitMatchForm' && (
                                  <>
                                    <button
                                      onClick={() => navigate(`/contest/subcontest-team/${subContest.contest_id}`)}
                                      style={{
                                        padding: '4px 8px',
                                        backgroundColor: '#3b82f6',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '3px',
                                        cursor: 'pointer',
                                        fontSize: '13px'
                                      }}
                                    >
                                      分配隊伍
                                    </button>
                                    
                                    {/* 產生對戰單按鈕 - 只在循環賽且已分配隊伍時顯示 */}
                                    {subContest.match_mode === 'round_robin' && subContest.team_count && subContest.team_count > 0 && (
                                      <button
                                        onClick={() => handleGenerateRoundRobinMatches(subContest.contest_id)}
                                        style={{
                                          padding: '4px 8px',
                                          backgroundColor: '#f59e0b',
                                          color: 'white',
                                          border: 'none',
                                          borderRadius: '3px',
                                          cursor: 'pointer',
                                          fontSize: '13px',
                                          fontWeight: 'bold'
                                        }}
                                        title="為循環賽產生對戰單"
                                      >
                                        📋 產生對戰單
                                      </button>
                                    )}
                                    
                                    {/* 刪除子賽事按鈕 - 所有賽制都可以刪除 */}
                                    <button
                                      onClick={() => handleDeleteSubContest(subContest.contest_id)}
                                      style={{
                                        padding: '4px 8px',
                                        backgroundColor: '#dc2626',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '3px',
                                        cursor: 'pointer',
                                        fontSize: '13px'
                                      }}
                                      title="刪除子賽事（僅限尚未產生對戰表的子賽事）"
                                    >
                                      🗑️ 刪除
                                    </button>
                                  </>
                                )}
                                
                                {/* 查看賽程按鈕 - 根據賽制跳轉不同頁面 */}
                                <button
                                  onClick={() => {
                                    if (subContest.match_mode === 'round_robin') {
                                      navigate(`/contest/${subContest.contest_id}/battleroom`);
                                    } else {
                                      navigate(`/contest/${subContest.contest_id}/bracket`);
                                    }
                                  }}
                                  style={{
                                    padding: '4px 8px',
                                    backgroundColor: '#6b7280',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '3px',
                                    cursor: 'pointer',
                                    fontSize: '13px'
                                  }}
                                >
                                  查看賽程
                                </button>
                              </div>
                            </div>
                            
                            {/* 隊伍列表顯示區域 */}
                            {showTeamsList[subContest.contest_id] && (
                              <div style={{
                                marginTop: '8px',
                                padding: '8px',
                                backgroundColor: '#f8fafc',
                                borderRadius: '4px',
                                border: '1px solid #e2e8f0'
                              }}>
                                <h6 style={{ margin: '0 0 6px 0', fontSize: '14px', fontWeight: 'bold', color: '#374151' }}>
                                  參賽隊伍列表 ({subContestTeams[subContest.contest_id]?.length || 0} 隊)
                                </h6>
                                {subContestTeams[subContest.contest_id] && subContestTeams[subContest.contest_id].length > 0 ? (
                                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '6px' }}>
                                    {subContestTeams[subContest.contest_id].map((team, index) => (
                                      <div
                                        key={team.contest_team_id}
                                        style={{
                                          padding: '6px',
                                          backgroundColor: 'white',
                                          borderRadius: '3px',
                                          border: '1px solid #d1d5db',
                                          fontSize: '13px'
                                        }}
                                      >
                                        <div style={{ fontWeight: 'bold', marginBottom: '1px' }}>
                                          {index + 1}. {team.team_name}
                                        </div>
                                        <div style={{ color: '#6b7280' }}>
                                          隊長: {team.captain_name}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <div style={{ color: '#6b7280', fontSize: '13px', fontStyle: 'italic' }}>
                                    尚未分配隊伍
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  // 渲染創建子賽事對話框
  const renderCreateSubContestDialog = () => {
    if (!showCreateSubContest) return null;
    
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
          maxWidth: '500px',
          width: '90%',
          maxHeight: '80vh',
          overflow: 'auto'
        }}>
          <h3 style={{ marginBottom: '20px', fontSize: '18px', fontWeight: 'bold' }}>
            創建新的子賽事階段
          </h3>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
                賽事名稱 *
              </label>
              <input
                type="text"
                value={newSubContest.contest_name}
                onChange={(e) => setNewSubContest(prev => ({ ...prev, contest_name: e.target.value }))}
                placeholder="例如：預賽第一輪"
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #ccc',
                  borderRadius: '4px',
                  fontSize: '14px'
                }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
                  階段順序
                </label>
                <input
                  type="number"
                  min="1"
                  value={newSubContest.stage_order}
                  onChange={(e) => {
                    const newStageOrder = parseInt(e.target.value) || 1;
                    const matchModeText = newSubContest.match_mode === 'round_robin' ? '循環賽' : '淘汰賽';
                    const groupText = newSubContest.parallel_group || 'A';
                    const updatedContestName = contestData ? 
                      `${contestData.contest_name}-第${newStageOrder}階段-${matchModeText}-${groupText}組` : 
                      `階段${newStageOrder}`;
                    
                    setNewSubContest(prev => ({ 
                      ...prev, 
                      stage_order: newStageOrder,
                      contest_name: updatedContestName
                    }));
                  }}
                  style={{
                    width: '100%',
                    padding: '8px',
                    border: '1px solid #ccc',
                    borderRadius: '4px',
                    fontSize: '14px'
                  }}
                />
              </div>
              
              <div>
                <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
                  平行組別 (可選)
                </label>
                <input
                  type="text"
                  value={newSubContest.parallel_group}
                  onChange={(e) => {
                    const newParallelGroup = e.target.value;
                    const matchModeText = newSubContest.match_mode === 'round_robin' ? '循環賽' : '淘汰賽';
                    const groupText = newParallelGroup || 'A';
                    const updatedContestName = contestData ? 
                      `${contestData.contest_name}-第${newSubContest.stage_order}階段-${matchModeText}-${groupText}組` : 
                      `階段${newSubContest.stage_order}`;
                    
                    setNewSubContest(prev => ({ 
                      ...prev, 
                      parallel_group: newParallelGroup,
                      contest_name: updatedContestName
                    }));
                  }}
                  placeholder="例如：A, B, C..."
                  maxLength={10}
                  style={{
                    width: '100%',
                    padding: '8px',
                    border: '1px solid #ccc',
                    borderRadius: '4px',
                    fontSize: '14px'
                  }}
                />
              </div>
            </div>
            
            <div>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
                賽制模式
              </label>
              <select
                value={newSubContest.match_mode}
                onChange={(e) => {
                  const newMatchMode = e.target.value as 'round_robin' | 'elimination';
                  const matchModeText = newMatchMode === 'round_robin' ? '循環賽' : '淘汰賽';
                  
                  // 更新賽事名稱以反映新的賽制
                  let updatedContestName = newSubContest.contest_name;
                  if (contestData && updatedContestName.includes(contestData.contest_name)) {
                    // 如果名稱包含父賽事名稱，則更新賽制部分
                    const nameParts = updatedContestName.split('-');
                    if (nameParts.length >= 4) {
                      nameParts[2] = matchModeText; // 更新賽制部分
                      updatedContestName = nameParts.join('-');
                    }
                  }
                  
                  setNewSubContest(prev => ({ 
                    ...prev, 
                    match_mode: newMatchMode,
                    contest_name: updatedContestName
                  }));
                }}
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #ccc',
                  borderRadius: '4px',
                  fontSize: '14px'
                }}
              >
                <option value="elimination">淘汰賽</option>
                <option value="round_robin">循環賽</option>
              </select>
            </div>
            
            <div>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
                晉級隊伍數量
              </label>
              <input
                type="number"
                min="1"
                value={newSubContest.advancement_count}
                onChange={(e) => setNewSubContest(prev => ({ 
                  ...prev, 
                  advancement_count: parseInt(e.target.value) || 1 
                }))}
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #ccc',
                  borderRadius: '4px',
                  fontSize: '14px'
                }}
              />
            </div>
            
            <div>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
                賽制說明
              </label>
              <textarea
                value={newSubContest.rule_text}
                onChange={(e) => setNewSubContest(prev => ({ ...prev, rule_text: e.target.value }))}
                placeholder="輸入賽制規則說明..."
                rows={3}
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #ccc',
                  borderRadius: '4px',
                  fontSize: '14px',
                  resize: 'vertical'
                }}
              />
            </div>
          </div>
          
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '24px' }}>
            <button
              onClick={() => setShowCreateSubContest(false)}
              style={{
                padding: '8px 16px',
                color: '#666',
                border: '1px solid #ccc',
                borderRadius: '4px',
                backgroundColor: 'white',
                cursor: 'pointer'
              }}
            >
              取消
            </button>
            <button
              onClick={handleCreateSubContest}
              style={{
                padding: '8px 16px',
                backgroundColor: '#10b981',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: 'bold'
              }}
            >
              創建
            </button>
          </div>
        </div>
      </div>
    );
  };

  // 初始化
  useEffect(() => {
    if (!user || !user.team_id) {
      setError('請先登入並確認您有團隊權限');
      setLoading(false);
      return;
    }
    
    fetchContestData();
  }, [contestId]);

  // 定期刷新待排清單以確保數據同步
  useEffect(() => {
    if (!contestData) return;
    
    // 設置定期刷新，每30秒檢查一次
    const interval = setInterval(() => {
      console.log('定期刷新待排清單...');
      fetchPendingTeams();
    }, 30000); // 30秒
    
    return () => clearInterval(interval);
  }, [contestData]);

  // 當頁面獲得焦點時也刷新數據
  useEffect(() => {
    const handleFocus = () => {
      console.log('頁面獲得焦點，刷新待排清單...');
      fetchPendingTeams();
    };
    
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, []);

  // 移除自動監控主賽事完成條件的邏輯，讓管理者自行判斷是否要結束
  // useEffect(() => {
  //   if (contestData && subContests.length > 0 && pendingTeams.length >= 0) {
  //     const shouldShowPrompt = checkMainContestCompletion();
  //     if (shouldShowPrompt && !showFinishPrompt) {
  //       setShowFinishPrompt(true);
  //     }
  //   }
  // }, [contestData, subContests, pendingTeams, showFinishPrompt]);

  // 清除訊息
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(''), 3000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(''), 5000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '40px' }}>
        <div>載入中...</div>
      </div>
    );
  }

  return (
    <div className="custom-tournament-page" style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '8px' }}>
          🏆 混合賽管理：{contestData?.contest_name}
        </h1>
        <div style={{ fontSize: '14px', color: '#666' }}>
          管理多階段賽事的隊伍分配和晉級流程
        </div>
      </div>

      {error && (
        <div style={{
          backgroundColor: '#fee2e2',
          border: '1px solid #fca5a5',
          borderRadius: '6px',
          padding: '12px',
          marginBottom: '16px',
          color: '#dc2626'
        }}>
          ❌ {error}
        </div>
      )}

      {/* 主賽事結束提示 */}
      {showFinishPrompt && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000
        }}>
          <div style={{
            backgroundColor: 'white',
            padding: '30px',
            borderRadius: '8px',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
            maxWidth: '500px',
            textAlign: 'center'
          }}>
            <h3 style={{ margin: '0 0 15px 0', color: '#333' }}>🏁 賽事完成確認</h3>
            <p style={{ margin: '0 0 20px 0', color: '#666', lineHeight: '1.5' }}>
              所有子賽事已完成。<br/>
              確定要結束主賽事嗎？<br/>
              <small style={{ color: '#999' }}>注意：結束後將無法再新增子賽事階段</small>
            </p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button
                onClick={handleFinishMainContest}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#dc3545',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontWeight: 'bold'
                }}
              >
                結束主賽事
              </button>
              <button
                onClick={handleCancelFinish}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#6c757d',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {successMessage && (
        <div style={{
          backgroundColor: '#d1fae5',
          border: '1px solid #6ee7b7',
          borderRadius: '6px',
          padding: '12px',
          marginBottom: '16px',
          color: '#059669'
        }}>
          ✅ {successMessage}
        </div>
      )}

      {/* 控制按鈕 */}
      <div style={{ 
        display: 'flex', 
        gap: '12px', 
        marginBottom: '20px',
        padding: '16px',
        backgroundColor: '#f8f9fa',
        borderRadius: '8px'
      }}>
        <button
          onClick={() => navigate('/contest-control')}
          style={{
            padding: '8px 16px',
            backgroundColor: '#6b7280',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer'
          }}
        >
          返回賽事控制台
        </button>
        <button
          onClick={() => navigate(`/contest/${contestId}/results`)}
          style={{
            padding: '8px 16px',
            backgroundColor: '#3b82f6',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer'
          }}
        >
          查看整體結果
        </button>
        
        {/* 🆕 條件式顯示「確定比賽結束」按鈕 */}
        {canShowFinishButton() && (
          <button
            onClick={() => setShowFinishPrompt(true)}
            style={{
              padding: '8px 16px',
              backgroundColor: '#dc2626',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 'bold'
            }}
          >
            🏁 確定比賽結束
          </button>
        )}
      </div>

      {/* 待排清單 */}
      {renderPendingTeams()}

      {/* 子賽事列表 */}
      {renderSubContests()}

      {/* 創建子賽事對話框 */}
      {renderCreateSubContestDialog()}

      {/* 說明區塊 */}
      <div style={{
        backgroundColor: '#fffbeb',
        border: '1px solid #fbbf24',
        borderRadius: '6px',
        padding: '16px',
        marginTop: '20px'
      }}>
        <h4 style={{ margin: '0 0 12px 0', color: '#92400e' }}>💡 使用說明</h4>
        <ul style={{ margin: 0, paddingLeft: '20px', color: '#92400e', fontSize: '14px' }}>
          <li>待排清單顯示所有等待分配到下一階段的隊伍</li>
          <li>可以創建多個子賽事階段，每個階段可設定不同的賽制和晉級數量</li>
          <li>子賽事完成後，晉級隊伍會自動加入待排清單</li>
          <li>只有在「WaitMatchForm」狀態（尚未產生對戰表）的子賽事才能被刪除</li>
          <li>刪除子賽事時，已分配的隊伍會自動回到待排清單</li>
          <li>重複此流程直到產生最終的冠軍隊伍</li>
        </ul>
      </div>
    </div>
  );
};

export default CustomTournamentPage;