// @ts-ignore
import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';



interface Team {
  contest_team_id: string;
  team_name: string;
}

const SubContestTeamManagementPage: React.FC = () => {
  const { contestId } = useParams<{ contestId: string }>();
  // 使用 window.location.href 代替 navigate 以避免版本不兼容問題
  const [groupName, setGroupName] = useState('');
  const [availableTeams, setAvailableTeams] = useState<Team[]>([]);
  const [assignedTeams, setAssignedTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatingTeamId, setUpdatingTeamId] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);

  // 動態更新子賽事的 expected_teams 欄位
  const updateExpectedTeams = async () => {
    try {
      if (!contestId) return;
      
      // 獲取當前子賽事分配的隊伍數量
      const { data: assignedCount, error: countError } = await supabase
        .from('contest_group_assignment')
        .select('contest_team_id', { count: 'exact' })
        .eq('group_contest_id', contestId);
      
      if (countError) {
        console.error('獲取分配隊伍數量失敗:', countError);
        return;
      }
      
      const actualTeamCount = assignedCount?.length || 0;
      console.log(`更新子賽事 ${contestId} 的 expected_teams 為:`, actualTeamCount);
      
      // 更新 contest 表的 expected_teams 欄位
      const { error: updateError } = await supabase
        .from('contest')
        .update({ expected_teams: actualTeamCount })
        .eq('contest_id', contestId);
      
      if (updateError) {
        console.error('更新 expected_teams 失敗:', updateError);
      } else {
        console.log('成功更新 expected_teams 為:', actualTeamCount);
      }
    } catch (err) {
      console.error('更新 expected_teams 時發生錯誤:', err);
    }
  };

  // 與其它頁面一致，從 localStorage 取得登入資訊
  useEffect(() => {
    const storedUser = localStorage.getItem('loginUser');
    console.log('[SubContestTeamManagementPage] localStorage.loginUser:', storedUser);
    if (storedUser) {
      const parsed = JSON.parse(storedUser);
      console.log('[SubContestTeamManagementPage] parsed loginUser:', parsed);
      if (parsed && parsed.id) {
        setCurrentUser(parsed);
      } else {
        setCurrentUser(null);
      }
    } else {
      setCurrentUser(null);
    }
  }, []);



  // 載入主要資料
  useEffect(() => {
    // 頁面加載時記錄用戶狀態
    
    const fetchGroupData = async () => {
      if (!contestId) return;
      setLoading(true);
      setError('');
      try {
        // 記錄數據加載前的用戶狀態
        
        const { data: groupData, error: groupError } = await supabase
          .from('contest')
          .select('contest_name, parent_contest_id')
          .eq('contest_id', contestId)
          .single();

        if (groupError) {
          console.error('獲取分組資訊時出錯:', JSON.stringify(groupError, null, 2));
          throw new Error('無法載入分組資訊(網路或權限問題)');
        }
        
        if (!groupData?.parent_contest_id) {
          console.error('分組資料缺少 parent_contest_id:', groupData);
          throw new Error('此賽事非有效分組(缺少父賽事ID)');
        }

        setGroupName(groupData.contest_name);
        const parentId = groupData.parent_contest_id;

        // 重新設計查詢邏輯：先取得父賽事的 contest_team 資料
        console.log('正在查詢父賽事 ID:', parentId);
        
        // 直接從 contest_team 表獲取父賽事的隊伍資料（包含 contest_team_id 和 team_name）
        const { data: parentTeamsData, error: parentTeamsError } = await supabase
          .from('contest_team')
          .select('contest_team_id, team_name')
          .eq('contest_id', parentId);
        
        if (parentTeamsError) {
          console.error('獲取父賽事隊伍資料失敗:', parentTeamsError);
          throw new Error('獲取父比賽隊伍失敗');
        }
        
        console.log('父賽事隊伍資料:', parentTeamsData);
        
        // 如果沒有父賽事隊伍，返回空數組
        if (!parentTeamsData || parentTeamsData.length === 0) {
          console.log('父賽事沒有隊伍');
          setAvailableTeams([]);
          setAssignedTeams([]);
          return;
        }

        // 直接使用 contest_team 表中的隊伍資料
        const allParentTeams = parentTeamsData.map((item: any) => ({
          contest_team_id: item.contest_team_id,
          team_name: item.team_name
        })) as Team[];
        
        console.log('處理後的父賽事隊伍:', allParentTeams); // 查看處理後的資料

        // 查詢本輪（同一 parent_contest_id 下所有分組）的 group_contest_id
        const { data: allGroups, error: allGroupsError } = await supabase
          .from('contest')
          .select('contest_id')
          .eq('parent_contest_id', parentId);
        if (allGroupsError) {
          throw new Error('查詢本輪分組失敗: ' + allGroupsError.message);
        }
        const groupIds = allGroups.map((g: any) => g.contest_id);

        // 查詢本輪所有分組已分配的隊伍
        const { data: allAssignedTeamsData, error: assignedTeamsError } = await supabase
          .from('contest_group_assignment')
          .select('contest_team_id, team_name, group_contest_id')
          .in('group_contest_id', groupIds);
        
        if (assignedTeamsError) {
          console.error('獲取已分配隊伍失敗:', assignedTeamsError);
          throw new Error('獲取已分配隊伍失敗');
        }
        
        console.log('所有分組的已分配隊伍資料:', allAssignedTeamsData);

        // 從所有已分配的隊伍中，篩選出屬於當前分組的隊伍
        const currentGroupAssignedTeams = allAssignedTeamsData
          .filter((item: any) => item.group_contest_id.toString() === contestId)
          .map((item: any) => ({ contest_team_id: item.contest_team_id, team_name: item.team_name }));
        
        setAssignedTeams(currentGroupAssignedTeams);
        console.log(`當前分組 (${contestId}) 的隊伍:`, currentGroupAssignedTeams);

        // 找出所有已被分配到任何組的隊伍ID
        const allAssignedTeamIds = new Set(allAssignedTeamsData.map((t: any) => t.contest_team_id));
        
        // 可用隊伍 = 父賽事所有隊伍 - 所有已被分配的隊伍
        setAvailableTeams(allParentTeams.filter((t: Team) => !allAssignedTeamIds.has(t.contest_team_id)));
      } catch (err: any) {
        setError(err.message);
      
      // 如果是用戶授權錯誤，添加重新登錄建議
      if (err.message.includes('無法獲取用戶') || err.message.includes('授權') || err.message.includes('登錄')) {
        console.warn('偏向授權問題，建議重新登錄');
        // 可以在這裡加入自動跳轉登錄頁的邏輯如果需要
      }
      } finally {
        setLoading(false);
      }
    };
    
    fetchGroupData();
  }, [contestId]);

  const handleTeamUpdate = async (team: Team, action: 'add' | 'remove') => {
    console.log(`嘗試${action === 'add' ? '添加' : '移除'}隊伍:`, team);
    setUpdatingTeamId(team.contest_team_id);
    setError('');
    
    const originalAssigned = [...assignedTeams];
    const originalAvailable = [...availableTeams];

    // 先在UI上更新
    if (action === 'add') {
      setAvailableTeams((prev: Team[]) => prev.filter((t: Team) => t.contest_team_id !== team.contest_team_id));
      setAssignedTeams((prev: Team[]) => [...prev, team]);
    } else {
      setAssignedTeams((prev: Team[]) => prev.filter((t: Team) => t.contest_team_id !== team.contest_team_id));
      setAvailableTeams((prev: Team[]) => [...prev, team]);
    }

    try {
      // 獲取當前分組的父賽事ID
      const { data: groupData, error: groupError } = await supabase
        .from('contest')
        .select('parent_contest_id')
        .eq('contest_id', contestId)
        .single();
      
      if (groupError) {
        console.error('獲取分組父賽事ID失敗:', groupError);
        throw new Error(`獲取分組信息失敗: ${groupError.message}`);
      }
      
      if (!groupData) {
        throw new Error('無法找到分組信息');
      }
      
      const parentContestId = groupData.parent_contest_id;
      console.log('父賽事ID:', parentContestId);
      
      // 僅用 currentUser 來自 localStorage
      if (!currentUser || !currentUser.id) {
        throw new Error('無法獲取用戶資訊，請重新登入後再試');
      }
      console.log('團隊更新前檢查用戶:', currentUser.name || currentUser.member_id || currentUser.id);

      if (action === 'add') {
        console.log('正在添加隊伍到資料庫...');
        // 檢查是否已存在相同的分配
        const { data: existingAssignment, error: checkError } = await supabase
          .from('contest_group_assignment')
          .select('assignment_id')
          .eq('group_contest_id', parseInt(contestId as string))
          .eq('contest_team_id', team.contest_team_id)
          .maybeSingle();
          
        if (checkError) {
          console.error('檢查現有分配時出錯:', checkError);
        }
        
        // 如果已存在分配，則跳過
        if (existingAssignment) {
          console.log('隊伍已存在於分組中，跳過添加');
          return;
        }
        
        // 將隊伍添加到 contest_group_assignment 表
        // 確保轉換為整數型別以符合資料庫結構
        console.log('添加隊伍，資料類型轉換前:', { 
          main_contest_id: parentContestId, 
          group_contest_id: parseInt(contestId as string), 
          contest_team_id: team.contest_team_id 
        });
        
        const { data: insertData, error: insertError } = await supabase.from('contest_group_assignment').insert({
          main_contest_id: parentContestId,
          group_contest_id: parseInt(contestId as string),
          contest_team_id: team.contest_team_id,
          team_name: team.team_name,
          created_by: currentUser.name || currentUser.member_id || currentUser.id,
          status: 'active'
        }).select();
        
        if (insertError) {
          console.error('添加隊伍到分組失敗:', insertError);
          throw new Error(`添加隊伍失敗: ${insertError.message}`);
        }
        
        console.log('隊伍成功添加到分組，返回資料:', insertData);
      } else {
        console.log('正在從資料庫中移除隊伍...');
        // 從 contest_group_assignment 表中刪除隊伍
        // 同樣需要確保 ID 型別轉換
        console.log('刪除隊伍，資料類型轉換前:', { 
          group_contest_id: parseInt(contestId as string), 
          contest_team_id: team.contest_team_id 
        });
        
        const { data: deleteData, error: deleteError } = await supabase
          .from('contest_group_assignment')
          .delete()
          .match({ 
            group_contest_id: parseInt(contestId as string), 
            contest_team_id: team.contest_team_id 
          })
          .select();
          
        if (deleteError) {
          console.error('從分組中移除隊伍失敗:', deleteError);
          throw new Error(`移除隊伍失敗: ${deleteError.message}`);
        }
        
        console.log('隊伍成功從分組中移除，返回資料:', deleteData);
      }
      
      // 動態更新子賽事的 expected_teams 欄位
      await updateExpectedTeams();
      
    } catch (err: any) {
      console.error('處理隊伍分配時出錯:', err);
      setError(`更新隊伍失敗: ${err.message}`);
      // 恢復原始狀態
      setAssignedTeams(originalAssigned);
      setAvailableTeams(originalAvailable);
    } finally {
      setUpdatingTeamId(null);
    }
  };

  if (loading) return <div className="p-8 text-center">載入分組資訊中...</div>;

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="bg-white shadow-lg rounded-lg p-6 mb-6">
        {/* 頂部用戶資訊區 - 即使未登入也顯示狀態 */}
        <div className="flex justify-between items-center p-3 bg-gray-50 rounded border border-gray-200">
          <div>
            <span className="font-medium">當前登入狀態: </span>
            {currentUser ? (
              <span className="font-bold">{currentUser.name || currentUser.member_id || currentUser.id}</span>
            ) : (
              <span className="text-red-500 font-bold">未登入或會話已過期</span>
            )}
          </div>
          <div>
            {currentUser ? (
              <div className="flex flex-col items-end">
                <span className="text-sm text-blue-600">角色: {currentUser.role || '一般用戶'}</span>
                <span className="text-xs text-gray-500">UID: {currentUser.id?.slice(0, 8) || ''}</span>
              </div>
            ) : (
              <button 
                onClick={() => {
                  console.log('清除會話並重定向到登入頁...');
                  // 先登出再重定向到登入頁
                  supabase.auth.signOut().then(() => {
                    console.log('登出成功，清除會話');
                    window.location.href = '/login';
                  });
                }} 
                className="text-sm bg-yellow-500 hover:bg-yellow-600 text-white px-4 py-1.5 rounded-md font-medium">
                重新登入
              </button>
            )}
          </div>
        </div>
        
        <div className="mt-4">
          <button 
            onClick={() => { window.location.href = '/contest/control'; }} 
            className="text-indigo-600 hover:text-indigo-800">
            &larr; 返回賽程控制區
          </button>
        </div>
      </div>
      
      <div className="text-3xl font-bold text-gray-900 mb-2">管理分組: {groupName || '載入中...'}</div>
      <p className="text-gray-600 mb-6">將父賽事的隊伍分配到這個分組中。</p>
      
      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4" role="alert">
          {error}
        </div>
      )}
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="bg-white p-6 rounded-lg shadow-md">
          <h2 className="text-xl font-semibold mb-4">可分配的隊伍 ({availableTeams.length})</h2>
          <ul className="space-y-2 h-96 overflow-y-auto">
            {availableTeams.map((team: Team) => (
              <li key={team.contest_team_id + '_' + team.team_name} className="flex justify-between items-center p-3 bg-gray-50 rounded-md">
                <span>{team.team_name}</span>
                <button 
                  onClick={() => handleTeamUpdate(team, 'add')} 
                  disabled={updatingTeamId === team.contest_team_id} 
                  className="bg-green-500 text-white p-2 rounded-full hover:bg-green-600 disabled:bg-gray-300"
                >
                  →
                </button>
              </li>
            ))}
          </ul>
        </div>
        
        <div className="bg-white p-6 rounded-lg shadow-md">
          <h2 className="text-xl font-semibold mb-4">已分配的隊伍 ({assignedTeams.length})</h2>
          <ul className="space-y-2 h-96 overflow-y-auto">
            {assignedTeams.map((team: Team) => (
              <li key={team.contest_team_id + '_' + team.team_name} className="flex justify-between items-center p-3 bg-blue-50 rounded-md">
                <span>{team.team_name}</span>
                <button 
                  onClick={() => handleTeamUpdate(team, 'remove')} 
                  disabled={updatingTeamId === team.contest_team_id} 
                  className="bg-red-500 text-white p-2 rounded-full hover:bg-red-600 disabled:bg-gray-300"
                >
                  &times;
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
};

export default SubContestTeamManagementPage;
