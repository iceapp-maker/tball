import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient'; // 請確保路徑正確

interface MatchDetail {
  match_detail_id: number;
  match_id: number;
  team1_member_ids: string[] | string; // 可能是字符串或字符串数组
  team2_member_ids: string[] | string;
  winner_team_id: number | null;
  score: string | null;
  sequence: number;
  match_type: 'single' | 'double' | '單打' | '雙打';
  table_no: number | null | string; // 可以是 number, null 或字符串 "--"
  team1_name: string;
  team2_name: string;
  team1_members: string[];
  team2_members: string[];
  team1_members_submitted: boolean; // 隊伍1是否已提交名單
  team2_members_submitted: boolean; // 隊伍2是否已提交名單
  winner_team_name?: string; // 新增：勝方隊伍名稱
  team1_id: number | undefined;
  team2_id: number | undefined;
}

const ContestTableView: React.FC = () => {
  const { contestId } = useParams<{ contestId: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [contestName, setContestName] = useState('');
  const [matches, setMatches] = useState<MatchDetail[]>([]);
  const [tableCount, setTableCount] = useState<number>(1);
  const [totalPoints, setTotalPoints] = useState<number>(1);
  const [teamCaptains, setTeamCaptains] = useState<{[teamId: string]: string}>({});

  // Debug 資訊相關狀態
  const [debugAssignedMatches, setDebugAssignedMatches] = useState<MatchDetail[]>([]);
  const [debugNextMatches, setDebugNextMatches] = useState<MatchDetail[]>([]);
  const [showDebugInfo, setShowDebugInfo] = useState<boolean>(false); // 預設關閉 debug 資訊
  
  // 分類後的比賽列表
  const [assignedMatches, setAssignedMatches] = useState<MatchDetail[]>([]);
  const [nextMatches, setNextMatches] = useState<MatchDetail[]>([]);
  const [remainingMatches, setRemainingMatches] = useState<MatchDetail[]>([]);

  // 新增狀態控制重配桌次彈出視窗
  const [showRelocateModal, setShowRelocateModal] = useState(false);
  const [selectedMatchToRelocate, setSelectedMatchToRelocate] = useState<MatchDetail | null>(null);
  const [eligibleMatchesForRelocation, setEligibleMatchesForRelocation] = useState<MatchDetail[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      await fetchContestDetails();
      await fetchMatches();
    };
    fetchData();
  }, [contestId]);

  const fetchContestDetails = async () => {
    try {
      const { data, error } = await supabase
        .from('contest')
        .select('contest_name, table_count, total_points')
        .eq('contest_id', contestId)
        .single();

      if (error) throw error;
      if (data) {
        setContestName(data.contest_name);
        setTableCount(data.table_count || 1);
        setTotalPoints(data.total_points || 1);
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  const fetchMatches = async () => {
    setLoading(true);
    setError('');

    try {
      const { data: matchData, error: matchError } = await supabase
        .from('contest_match')
        .select('match_id, team1_id, team2_id')
        .eq('contest_id', contestId);

      if (matchError) throw matchError;
      if (!matchData || matchData.length === 0) return;

      const { data: detailData, error: detailError } = await supabase
        .from('contest_match_detail')
        .select('*')
        .in('match_id', matchData.map(m => m.match_id));

      if (detailError) throw detailError;

      const teamIds = matchData.flatMap(m => [m.team1_id, m.team2_id]).filter(id => id !== null);

      const { data: teamData } = await supabase
        .from('contest_team')
        .select('contest_team_id, team_name')
        .in('contest_team_id', teamIds);

      const { data: memberData } = await supabase
        .from('contest_team_member')
        .select('contest_team_id, member_id, member_name')
        .in('contest_team_id', teamIds);

      const processedMatches: MatchDetail[] = detailData.map(detail => {
        const match = matchData.find(m => m.match_id === detail.match_id);
        const team1 = teamData?.find(t => t.contest_team_id === match?.team1_id);
        const team2 = teamData?.find(t => t.contest_team_id === match?.team2_id);

        const parseIds = (ids: string[] | string) => {
          if (Array.isArray(ids)) return ids;
          try {
            const parsed = JSON.parse(ids);
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        };

        const team1Ids = parseIds(detail.team1_member_ids);
        const team2Ids = parseIds(detail.team2_member_ids);

        const getNames = (ids: string[], teamId?: number) =>
          ids.map(id =>
            memberData?.find(m => m.contest_team_id === teamId && m.member_id === id)?.member_name || id
          );

        const team1_members_submitted = team1Ids.length > 0;
        const team2_members_submitted = team2Ids.length > 0;

        return {
          ...detail,
          team1_id: match?.team1_id,
          team2_id: match?.team2_id,
          team1_name: team1?.team_name || '',
          team2_name: team2?.team_name || '',
          team1_members: getNames(team1Ids, match?.team1_id),
          team2_members: getNames(team2Ids, match?.team2_id),
          team1_members_submitted,
          team2_members_submitted,
          winner_team_name: teamData?.find(t => t.contest_team_id === detail.winner_team_id)?.team_name || ''
        };
      });

      const eligibleForRelocation = processedMatches.filter(m =>
        !m.score && m.team1_members_submitted && m.team2_members_submitted && (!m.table_no || m.table_no === '--')
      );

      // 所有已分配桌次的比賽（包括具體數字桌次和"Next"桌次）
      const assigned = processedMatches.filter(m => 
        m.table_no && m.table_no !== '--'
      );

      // 修改排序函數，使其與後端邏輯保持一致
      const sortMatches = (matches: MatchDetail[]) => {
        return [...matches].sort((a, b) => {
          // 處理"Next"桌次 - 放到最後
          if (a.table_no === 'Next' && b.table_no !== 'Next') {
            return 1; // a排在後面
          }
          if (a.table_no !== 'Next' && b.table_no === 'Next') {
            return -1; // b排在後面
          }
          
          // 修正：如果兩個都是"Next"，按match_detail_id由小到大排序（與後端一致）
          // 這樣UI中顯示順序與實際處理順序一致，顯示在前面的會先被安排
          if (a.table_no === 'Next' && b.table_no === 'Next') {
            return (a.match_detail_id || 0) - (b.match_detail_id || 0);
          }
          
          // 處理數字桌次 - 按照桌次號碼由小到大排序
          const tableNoA = typeof a.table_no === 'string' ? parseInt(a.table_no) : (a.table_no || 0); 
          const tableNoB = typeof b.table_no === 'string' ? parseInt(b.table_no) : (b.table_no || 0);
          
          // 如果兩個都是數字或可以轉換為數字
          if (!isNaN(tableNoA) && !isNaN(tableNoB)) {
            return tableNoA - tableNoB;
          }
          
          // 其他情況，保持原來的順序
          return 0;
        });
      };

      // 排序已分配桌次的比賽
      const sortedAssigned = sortMatches(assigned);
      
      // 區分"Next"桌次和數字桌次
      const nextMatches = sortedAssigned.filter(m => m.table_no === 'Next');
      const numericalMatches = sortedAssigned.filter(m => m.table_no !== 'Next');

      setAssignedMatches(sortedAssigned);
      setRemainingMatches(processedMatches.filter(m => !assigned.includes(m)));
      setMatches(sortedAssigned);
      setDebugAssignedMatches(sortedAssigned);
      
      // 可選：單獨設置"Next"桌次的比賽，方便UI顯示
      setNextMatches(nextMatches);
      
      setEligibleMatchesForRelocation(eligibleForRelocation);

      const allTeamIds = Array.from(new Set(
        processedMatches.flatMap(m => [m.team1_id, m.team2_id]).filter(id => id !== undefined)
      ));

      const captainsMap = await fetchTeamCaptains(allTeamIds as number[]);
      setTeamCaptains(captainsMap);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchTeamCaptains = async (teamIds: number[]) => {
    try {
      const { data } = await supabase
        .from('contest_team_member')
        .select('contest_team_id, member_name')
        .in('contest_team_id', teamIds)
        .eq('status', 'captain');

      const result: {[teamId: string]: string} = {};
      data?.forEach(item => {
        result[item.contest_team_id.toString()] = item.member_name;
      });
      return result;
    } catch {
      return {};
    }
  };

  const getTeamMembersDisplay = (match: MatchDetail, teamNumber: 1 | 2): React.ReactNode => {
    const isTeam1 = teamNumber === 1;
    const teamMembers = isTeam1 ? match.team1_members : match.team2_members;
    const membersSubmitted = isTeam1 ? match.team1_members_submitted : match.team2_members_submitted;

    if (membersSubmitted) {
      return teamMembers.join(', ');
    } else {
      return <span className="text-gray-400">人員名單未提</span>;
    }
  };

  const shouldShowActionButton = (match: MatchDetail): boolean => {
    return match.team1_members_submitted && match.team2_members_submitted && !match.score;
  };

  const navigateToGame = async (match: MatchDetail) => {
    // 準備 URL 參數
    const params = new URLSearchParams();
    
    // 添加來源標記和比賽詳情ID
    params.append('from_contesttableview', 'true'); // 更改來源標記
    params.append('match_detail_id', match.match_detail_id.toString());
    
    // 添加隊伍名稱
    params.append('team1_name', match.team1_name);
    params.append('team2_name', match.team2_name);
    
    // 解析 team1_member_ids 和 team2_member_ids
    const team1Ids = typeof match.team1_member_ids === 'string' 
      ? JSON.parse(match.team1_member_ids) 
      : match.team1_member_ids || [];
      
    const team2Ids = typeof match.team2_member_ids === 'string' 
      ? JSON.parse(match.team2_member_ids) 
      : match.team2_member_ids || [];

    // 判斷比賽類型：單打或雙打
    const isSingleMatch = (() => {
      // 首先檢查 match_type 字段，支持中文值
      if (match.match_type === 'single' || match.match_type === '單打') return true;
      if (match.match_type === 'double' || match.match_type === '雙打') return false;
      
      // 如果 match_type 不可靠，檢查成員數量
      const team1MemberCount = Array.isArray(team1Ids) ? team1Ids.length : 0;
      const team2MemberCount = Array.isArray(team2Ids) ? team2Ids.length : 0;
      
      // 如果兩隊都只有一名成員，則為單打
      if (team1MemberCount <= 1 && team2MemberCount <= 1) return true;
      
      // 如果任一隊有兩名或以上成員，則為雙打
      if (team1MemberCount >= 2 || team2MemberCount >= 2) return false;
      
      // 默認為單打
      return true;
    })();
    
    try {
      if (isSingleMatch) {
        // 單打比賽參數
        if (team1Ids[0]) { // 確保 playerIds[0] 存在
          params.append('player1', team1Ids[0]);
          params.append('player1_name', match.team1_members[0] || '');
          params.append('player1_member_id', team1Ids[0]);
        }
        
        if (team2Ids[0]) { // 確保 playerIds[1] 存在
          params.append('player2', team2Ids[0]);
          params.append('player2_name', match.team2_members[0] || '');
          params.append('player2_member_id', team2Ids[0]);
        }
        
        navigate(`/single_game?${params.toString()}`);
      } else {
        // 雙打比賽參數 - 確保與 NewAcceptedInvitesBlock.tsx 中的處理方式一致
        if (team1Ids.length > 0 && team1Ids[0]) {
          params.append('player1', team1Ids[0]);
          params.append('player1_name', match.team1_members[0] || '');
        }
        
        if (team1Ids.length > 1 && team1Ids[1]) {
          params.append('player2', team1Ids[1]);
          params.append('player2_name', match.team1_members[1] || '');
        }
        
        if (team2Ids.length > 0 && team2Ids[0]) {
          params.append('player3', team2Ids[0]);
          params.append('player3_name', match.team2_members[0] || '');
        }
        
        if (team2Ids.length > 1 && team2Ids[1]) {
          params.append('player4', team2Ids[1]);
          params.append('player4_name', match.team2_members[1] || '');
        }
        
        // 添加雙打頁面需要的隊伍成員和隊伍 ID 參數
        // 添加隊伍成員陳列
        params.append('team1_members', JSON.stringify(match.team1_members));
        params.append('team2_members', JSON.stringify(match.team2_members));
        
        // 添加隊伍 ID
        if (match.team1_id) {
          params.append('team1_id', match.team1_id.toString());
        }
        
        if (match.team2_id) {
          params.append('team2_id', match.team2_id.toString());
        }
        
        navigate(`/double_game?${params.toString()}`);
      }
    } catch (err: any) {
      console.error('導航錯誤:', err);
      setError(err.message);
    }
  };

  // 新增：處理重配桌次邏輯
  const handleRelocateTable = async (targetMatchDetailId: number) => {
    if (!selectedMatchToRelocate) return;

    setLoading(true);
    setError('');

    const sourceMatchDetailId = selectedMatchToRelocate.match_detail_id;
    const sourceTableNo = selectedMatchToRelocate.table_no;

    if (!sourceMatchDetailId || sourceTableNo === null || sourceTableNo === undefined) {
       console.error('來源比賽資訊不完整，無法重配桌次。');
       setLoading(false);
       return;
    }

    try {
      // 更新目標比賽的桌次
      console.log(`準備將比賽 ID ${targetMatchDetailId} 分配到桌次 ${sourceTableNo}`);
      const { error: targetUpdateError } = await supabase
        .from('contest_match_detail')
        .update({ table_no: sourceTableNo })
        .eq('match_detail_id', targetMatchDetailId);

      if (targetUpdateError) {
         console.error('更新目標比賽桌次錯誤:', targetUpdateError);
         throw targetUpdateError;
      }
      console.log(`成功更新比賽 ID ${targetMatchDetailId} 的桌次為 ${sourceTableNo}`);

      // 更新來源比賽的桌次為 "--"
      console.log(`準備將比賽 ID ${sourceMatchDetailId} 的桌次設為 "--"`);
      const { error: sourceUpdateError } = await supabase
        .from('contest_match_detail')
        .update({ table_no: '--' })
        .eq('match_detail_id', sourceMatchDetailId);

      if (sourceUpdateError) {
         console.error('更新來源比賽桌次錯誤:', sourceUpdateError);
         throw sourceUpdateError;
      }
      console.log(`成功更新比賽 ID ${sourceMatchDetailId} 的桌次為 "--"`);

      // 關閉彈出視窗並重新獲取數據
      setShowRelocateModal(false);
      setSelectedMatchToRelocate(null);
      fetchMatches();

    } catch (err: any) {
      console.error('重配桌次失敗:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const renderMatchCard = (match: MatchDetail, category?: string) => {
    let point = 1;
    if (totalPoints && totalPoints > 0) {
      // 使用 sequence 作為出賽點顯示
      point = match.sequence; 
    }
    
    // 判斷是否顯示「前往比賽」或「約」按鈕
    const showActionButton = shouldShowActionButton(match);
    const isNextMatch = match.table_no === 'Next';

    return (
      <div key={match.match_detail_id} className={`border rounded-lg p-4 bg-white shadow-sm ${category === '下一場' ? 'border-yellow-500' : ''}`}>
        {isNextMatch && (
          <div className="bg-yellow-100 text-yellow-800 px-3 py-1 rounded-full text-xs font-bold mb-2 inline-block">
            接下來要安排的對戰
          </div>
        )}
        
        <div className="flex justify-between items-center mb-2 border-b pb-2">
          <div className="font-bold text-blue-800">
            桌次：
            <span className="text-xl ml-1">
              {isNextMatch ? '下一場' : (match.table_no !== null && match.table_no !== undefined ? match.table_no : '未安排')}
            </span>
          </div>
          <div className="font-bold text-blue-800">出賽點 <span className="text-xl ml-1">{point}</span></div> 
        </div>

        {match.table_no !== null && match.table_no !== undefined && match.table_no !== '--' && !isNextMatch && (
          <button
            onClick={() => { setSelectedMatchToRelocate(match); setShowRelocateModal(true); }}
            className="mb-2 px-3 py-1 bg-yellow-500 hover:bg-yellow-600 text-white text-sm rounded-md"
          >
            重配桌次
          </button>
        )}

        <div className="flex justify-between items-center mb-4">
          <div className="text-center w-2/5">
            <div className="font-bold text-lg">{match.team1_name}</div>
             <div className="text-xs text-gray-500">({teamCaptains[match.team1_id?.toString()] || '無隊長'})</div>
            <div className="text-sm mt-1 text-gray-600">
              {getTeamMembersDisplay(match, 1)}
            </div>
          </div>

          <div className="text-center flex flex-col items-center">
            <div className="font-bold text-gray-500 mb-1">vs</div>
            <div className="font-bold text-2xl flex items-center justify-center space-x-2">
              {match.score ? match.score : '- : -'}
            </div>
          </div>

          <div className="text-center w-2/5">
            <div className="font-bold text-lg">{match.team2_name}</div>
             <div className="text-xs text-gray-500">({teamCaptains[match.team2_id?.toString()] || '無隊長'})</div>
            <div className="text-sm mt-1 text-gray-600">
              {getTeamMembersDisplay(match, 2)}
            </div>
          </div>
        </div>

        <div className="border-t pt-2 text-center">
           {match.score && match.winner_team_id ? (
             <span className="text-green-600 font-bold">{match.winner_team_name ? `${match.winner_team_name}獲勝` : '等待結果...'}</span>
           ) : showActionButton ? (
             <button
               className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-1 rounded"
               onClick={() => navigateToGame(match)} 
             >
               前往比賽
             </button>
           ) : (
             <span className="text-gray-400 italic text-sm">{match.score ? '比賽已結束' : '等待雙方提交名單'}</span>
           )}
        </div>
      </div>
    );
  };

  // 更新說明文本，讓用戶了解排序邏輯
  const renderExplanationText = () => {
    return (
      <div className="mt-6 p-4 bg-yellow-50 border border-yellow-200 rounded">
        <h3 className="font-bold text-yellow-800 mb-2">說明</h3>
        <ul className="list-disc pl-5 text-sm text-yellow-700">
          <li>此列表只顯示已分配桌次的比賽和接下來要安排的對戰。</li>
          <li>已分配桌次的比賽按照桌次號碼排序。</li>
          <li>「接下來要安排的對戰」為系統判斷可以優先安排的比賽，<strong>顯示在前面的比賽將會被優先安排。</strong></li>
        </ul>
      </div>
    );
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center">
          <button 
            onClick={() => navigate(-1)} 
            className="mr-4 bg-gray-200 hover:bg-gray-300 p-2 rounded-full"
          >
            &larr;
          </button>
          <h1 className="text-2xl font-bold">{contestName} - 桌次列表</h1>
        </div>
      </div>
      
      {showDebugInfo && (
        <div className="mb-6 p-4 bg-gray-100 border border-gray-300 rounded-lg">
          <h2 className="text-lg font-bold mb-3 text-gray-700 flex justify-between items-center">
            <span>調試資訊</span>
          </h2>
          <div className="overflow-auto max-h-96">
            <div className="mb-4">
              <h3 className="font-semibold mb-2 text-blue-700">已分配桌次的比賽 ({debugAssignedMatches.length})</h3>
              <div className="bg-white p-2 rounded text-xs overflow-x-auto whitespace-pre font-mono">
                {JSON.stringify(debugAssignedMatches, null, 2)}
              </div>
            </div>
            <div className="mb-4">
              <h3 className="font-semibold mb-2 text-yellow-700">接下來要安排的對戰 ({debugNextMatches.length})</h3>
              <div className="bg-white p-2 rounded text-xs overflow-x-auto whitespace-pre font-mono">
                {JSON.stringify(debugNextMatches, null, 2)}
              </div>
            </div>
          </div>
        </div>
      )}
      
      {loading ? (
        <p className="text-center">載入中...</p>
      ) : error ? (
        <p className="text-center text-red-500">{error}</p>
      ) : (
        <div className="space-y-6">
          {assignedMatches.length > 0 && (
            <div className="mb-6">
              <h2 className="text-xl font-bold mb-3 border-b pb-2">已分配桌次的比賽</h2>
              <div className="space-y-4">
                {assignedMatches.map((match: MatchDetail) => {
                  const isNextMatch = match.table_no === 'Next';
                  return renderMatchCard(
                    match, 
                    isNextMatch ? '下一場' : 'assigned'
                  );
                })}
              </div>
            </div>
          )}

          {renderExplanationText()}

          {showRelocateModal && selectedMatchToRelocate && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white p-6 rounded-lg shadow-xl w-96 max-h-[80vh] overflow-y-auto">
                <h3 className="text-lg font-bold mb-4">
                  選擇要分配到桌次 {typeof selectedMatchToRelocate.table_no === 'number' ? selectedMatchToRelocate.table_no : '--'}
                  的比賽
                </h3>
                <ul>
                  {eligibleMatchesForRelocation.map((match: MatchDetail) => (
                    <li 
                      key={match.match_detail_id} 
                      className="cursor-pointer p-3 hover:bg-gray-100 border-b last:border-b-0"
                      onClick={() => handleRelocateTable(match.match_detail_id)}
                    >
                      {match.team1_name} vs {match.team2_name} (ID: {match.match_detail_id})
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => { setShowRelocateModal(false); setSelectedMatchToRelocate(null); }}
                  className="mt-6 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-md"
                >
                  取消
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ContestTableView;
