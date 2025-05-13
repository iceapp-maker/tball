import React, { useContext, useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { UserContext } from '../UserContext';
import { supabase } from '../supabaseClient';

// 定義資料類型
interface MatchDetail {
  match_detail_id: string;
  match_id: string;
  match_type: string; // 單打或雙打
  sequence: number;
  team1_member_ids: string[] | null;
  team2_member_ids: string[] | null;
}

interface TeamMember {
  member_id: string;
  name: string;
  status?: string;
}

const LineupEditorPage: React.FC = () => {
  const { user } = useContext(UserContext) ?? { user: null };
  const navigate = useNavigate();
  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);
  const match_id = queryParams.get('match_id');
  const team_id = queryParams.get('team_id'); // 接收從NewTodoBlock傳遞的team_id參數
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [matchDetails, setMatchDetails] = useState<MatchDetail[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<Record<string, string[]>>({});
  const [matchInfo, setMatchInfo] = useState<{
    contest_name: string;
    team_name: string;
    opponent_name: string;
    team_id: string;
    contest_id: string;
    team_type: string; // 添加team_type欄位
  } | null>(null);
  const [captainId, setCaptainId] = useState<string | null>(null);

  // 獲取比賽詳情和隊員資料
  useEffect(() => {
    const fetchData = async () => {
      if (!match_id || !team_id || !user?.member_id) {
        setError('缺少必要參數');
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        // 1. 獲取比賽詳情
        const { data: matchData, error: matchError } = await supabase
          .from('contest_match')
          .select(`
            contest_id,
            team1_id,
            team2_id,
            team1:team1_id (team_name),
            team2:team2_id (team_name),
            contest:contest_id (contest_name)
          `)
          .eq('match_id', match_id)
          .single();

        if (matchError) throw matchError;
        
        // 根據 team_id 判斷是 team1 還是 team2
        // 將所有ID轉成字串並去除空白，確保型別一致
        const normalizedTeamId = (team_id || '').toString().trim();
        const normalizedTeam1Id = (matchData.team1_id || '').toString().trim();
        const normalizedTeam2Id = (matchData.team2_id || '').toString().trim();
        
        // 正確判斷 team_type
        const team_type = normalizedTeamId === normalizedTeam1Id ? 'team1' : 'team2';
        
        // 列印debug日誌以驗證判斷結果
        console.log('team_id from url:', normalizedTeamId);
        console.log('team1_id from db:', normalizedTeam1Id, 'team2_id from db:', normalizedTeam2Id);
        console.log('team_type 判斷:', team_type);
        
        // 設置我方隊伍和對手隊伍名稱
        const myTeamName = team_type === 'team1' ? matchData.team1?.team_name : matchData.team2?.team_name;
        const opponentName = team_type === 'team1' ? matchData.team2?.team_name : matchData.team1?.team_name;
        
        setMatchInfo({
          contest_name: matchData.contest?.contest_name || '未命名比賽',
          team_name: myTeamName || '我方隊伍',
          opponent_name: opponentName || '對手隊伍',
          team_id: team_id,
          contest_id: matchData.contest_id,
          team_type: team_type // 保存team_type
        });

        // 2. 獲取contest_match_detail中的比賽項目
        const { data: detailsData, error: detailsError } = await supabase
          .from('contest_match_detail')
          .select('*')
          .eq('match_id', match_id)
          .order('sequence', { ascending: true });

        if (detailsError) throw detailsError;
        setMatchDetails(detailsData || []);
        
        // 初始化selectedMembers
        const initialSelections: Record<string, string[]> = {};
        detailsData?.forEach((detail: MatchDetail) => {
          const key = `${detail.match_detail_id}`;
          const existingMembers = team_type === 'team1' 
            ? detail.team1_member_ids || []
            : detail.team2_member_ids || [];
          initialSelections[key] = Array.isArray(existingMembers) ? existingMembers : [];
        });
        setSelectedMembers(initialSelections);

        // 3. 獲取隊伍成員
        const { data: membersData, error: membersError } = await supabase
          .from('contest_team_member')
          .select(`
            member_id,
            member_name,
            status
          `)
          .eq('contest_team_id', team_id) // 直接使用傳入的team_id
          .eq('contest_id', matchData.contest_id); // 確保是相同比賽內的隊員
        
        if (membersError) throw membersError;
        
        // 格式化隊員資料
        const formattedMembers = membersData?.map(item => ({
          member_id: item.member_id,
          name: item.member_name || item.member_id,
          status: item.status
        })) || [];
        
        setTeamMembers(formattedMembers);
        
        // 直接使用登入者 ID 作為隊長 ID，因為只有隊長才能看到自己隊伍的連結
        if (user?.member_id) {
          setCaptainId(user.member_id);
        }
        
      } catch (err: any) {
        console.error('獲取資料失敗:', err);
        setError(err.message || '獲取資料時發生錯誤');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [match_id, team_id, user?.member_id]);

  // 處理隊員選擇變更
  const handleMemberSelection = (matchDetailId: string, memberIds: string[], maxMembers: number) => {
    // 如果選擇的隊員數量超過允許的最大值（例如，雙打最多選2人），則不更新
    if (memberIds.length > maxMembers) {
      return;
    }
    
    setSelectedMembers(prev => ({
      ...prev,
      [matchDetailId]: memberIds
    }));
  };

  // 儲存出賽名單
  const handleSaveLineup = async () => {
    if (!match_id || !matchInfo?.team_type || !matchInfo?.contest_id) {
      setError('缺少必要參數');
      return;
    }

    try {
      // 準備更新的資料
      const updates = Object.entries(selectedMembers).map(([matchDetailId, memberIds]) => {
        // 根據team_type更新不同欄位，並加入contest_id
        const updateData = matchInfo.team_type === 'team1' 
          ? { team1_member_ids: memberIds, contest_id: matchInfo.contest_id } 
          : { team2_member_ids: memberIds, contest_id: matchInfo.contest_id };
        
        return supabase
          .from('contest_match_detail')
          .update(updateData)
          .eq('match_id', match_id)
          .eq('match_detail_id', matchDetailId);
      });

      // 執行所有更新
      await Promise.all(updates);
      
      // 更新比賽狀態，標記名單已準備就緒
      const lineupReadyField = matchInfo.team_type === 'team1' ? 'team1_lineup_ready' : 'team2_lineup_ready';
      await supabase
        .from('contest_match')
        .update({ [lineupReadyField]: true })
        .eq('match_id', match_id);

      alert('出賽名單已成功儲存！');
      navigate('/'); // 返回首頁或其他適當頁面
    } catch (err: any) {
      console.error('儲存名單失敗:', err);
      setError(err.message || '儲存名單時發生錯誤');
    }
  };

  // 處理取消
  const handleCancel = () => {
    navigate('/');
  };

  // 渲染加載中狀態
  if (loading) {
    return (
      <div className="p-4">
        <h2 className="text-xl font-bold mb-4">正在載入資料...</h2>
      </div>
    );
  }

  // 渲染錯誤狀態
  if (error) {
    return (
      <div className="p-4">
        <h2 className="text-xl font-bold mb-4">發生錯誤</h2>
        <p className="text-red-500">{error}</p>
        <button 
          className="mt-4 px-4 py-2 bg-blue-500 text-white rounded"
          onClick={() => navigate('/')}
        >
          返回首頁
        </button>
      </div>
    );
  }

  return (
    <div className="p-4">
      <h2 className="text-xl font-bold mb-2">編排出賽名單</h2>
      
      {/* 顯示 Debug 資訊 */}
      {matchInfo && (
        <div className="mb-4">
          <div className="p-3 bg-gray-100 rounded mb-4 border-2 border-red-500">
            <h3 className="font-bold text-red-600">Debug 資訊:</h3>
            <p><strong>Match ID:</strong> {match_id}</p>
            <p><strong>Contest ID:</strong> {matchInfo.contest_id}</p>
            <p><strong>Team ID:</strong> {matchInfo.team_id}</p>
            <p><strong>Team Type:</strong> {matchInfo.team_type}</p>
            <p><strong>隊長 ID:</strong> {captainId || '未找到隊長'}</p>
          </div>
          
          <p><strong>比賽：</strong>{matchInfo.contest_name}</p>
          <p><strong>我方隊伍：</strong>{matchInfo.team_name}</p>
          <p><strong>對手隊伍：</strong>{matchInfo.opponent_name}</p>
        </div>
      )}
      
      {matchDetails.length === 0 ? (
        <p>沒有找到比賽項目資料</p>
      ) : (
        <>
          {matchDetails.map((detail) => {
            // 決定可選最大人數
            const maxMembers = detail.match_type === '雙打' ? 2 : 1;
            const matchDetailKey = `${detail.match_detail_id}`;
            
            return (
              <div key={detail.match_detail_id} className="mb-6 p-4 border rounded">
                <h3 className="font-bold mb-2">
                  比賽項目 {detail.sequence}: {detail.match_type}
                </h3>
                
                <div className="mb-4">
                  <label className="block mb-2">選擇出賽隊員 (最多{maxMembers}人):</label>
                  <select
                    multiple
                    value={selectedMembers[matchDetailKey] || []}
                    onChange={(e) => {
                      const selectedOptions = Array.from(
                        e.target.selectedOptions,
                        option => option.value
                      );
                      handleMemberSelection(matchDetailKey, selectedOptions, maxMembers);
                    }}
                    className="w-full p-2 border rounded"
                    size={5} // 顯示5行選項
                  >
                    {teamMembers.map((member) => (
                      <option key={member.member_id} value={member.member_id}>
                        {member.name} {member.status === 'captain' ? '(隊長)' : ''}
                      </option>
                    ))}
                  </select>
                  <p className="text-sm text-gray-500 mt-1">
                    已選 {selectedMembers[matchDetailKey]?.length || 0}/{maxMembers}
                  </p>
                  
                  {selectedMembers[matchDetailKey]?.length > 0 && (
                    <div className="mt-2">
                      <p className="font-medium">已選隊員:</p>
                      <ul className="list-disc pl-5">
                        {selectedMembers[matchDetailKey]?.map(memberId => {
                          const member = teamMembers.find(m => m.member_id === memberId);
                          return (
                            <li key={memberId}>
                              {member?.name || memberId} {member?.status === 'captain' ? '(隊長)' : ''}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          
          <div className="mt-6 flex gap-4">
            <button
              onClick={handleSaveLineup}
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
            >
              確認儲存
            </button>
            <button
              onClick={handleCancel}
              className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
            >
              取消
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default LineupEditorPage;