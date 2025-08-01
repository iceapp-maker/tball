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
    points_config: any; // 添加points_config欄位
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
            contest:contest_id (contest_name, points_config)
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
          team_type: team_type, // 保存team_type
          points_config: matchData.contest?.points_config // 保存points_config
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
        // team_id 從 URL 參數傳來時是字串，但資料庫中的 contest_team_id 是數字，需要轉換型別
        const teamIdInt = parseInt(team_id, 10);
        if (isNaN(teamIdInt)) {
          throw new Error('無效的 Team ID');
        }

        const { data: membersData, error: membersError } = await supabase
          .from('contest_team_member')
          .select(`
            member_id,
            member_name,
            status
          `)
          .eq('contest_team_id', teamIdInt); // 使用轉換後的數字型別 team_id
        
        if (membersError) throw membersError;
        
        // 格式化隊員資料
        const formattedMembers = membersData?.map((item: any) => ({
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
    
    setSelectedMembers((prev: Record<string, string[]>) => ({
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

    // 檢查是否所有比賽項目都有選擇足夠的選手
    const insufficientItems = matchDetails.filter((detail: MatchDetail) => {
      const detailKey = `${detail.match_detail_id}`;
      const selectedMemberIds = selectedMembers[detailKey] || [];
      const requiredMembers = detail.match_type === '雙打' ? 2 : 1;
      return selectedMemberIds.length < requiredMembers; // 雙打需要2人，單打需要1人
    });

    if (insufficientItems.length > 0) {
      // 有項目選手不足
      const warningMessages = insufficientItems.map((item: MatchDetail) => {
        const detailKey = `${item.match_detail_id}`;
        const currentCount = selectedMembers[detailKey]?.length || 0;
        const requiredCount = item.match_type === '雙打' ? 2 : 1;
        return `項目 ${item.sequence}: ${item.match_type} (已選${currentCount}/${requiredCount}人)`;
      }).join('\n');
      
      const confirmMessage = `警告：以下項目選手不足：\n${warningMessages}\n\n是否仍要儲存？`;
      
      if (!window.confirm(confirmMessage)) {
        return; // 用戶取消儲存
      }
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
      
      {matchInfo && (
        <div className="mb-4">
          <p><strong>比賽：</strong>{matchInfo.contest_name}</p>
          <p><strong>我方隊伍：</strong>{matchInfo.team_name}</p>
          <p><strong>對手隊伍：</strong>{matchInfo.opponent_name}</p>
        </div>
      )}
      
      {matchDetails.length === 0 ? (
        <p>沒有找到比賽項目資料</p>
      ) : (
        <>
          {matchDetails.map((detail: MatchDetail) => {
            // 比賽類型處理
            console.log(`比賽項目 ${detail.sequence} 原始類型:`, detail.match_type);
            
            // 從 points_config 中獲取正確的比賽類型
            const getMatchTypeFromPointsConfig = (): string | undefined => {
              if (matchInfo?.points_config && Array.isArray(matchInfo.points_config)) {
                // 獲取對應序號的配置
                const index = detail.sequence - 1;
                if (index < matchInfo.points_config.length) {
                  const config = matchInfo.points_config[index];
                  if (config && config.type) {
                    return config.type; // 使用 points_config 中的類型
                  }
                }
              }
              return undefined; // 如果找不到配置，返回 undefined
            };
            
            const getMatchTypeDisplay = (type: string): string => {
              // 首先嘗試從 points_config 獲取類型
              const configType = getMatchTypeFromPointsConfig();
              if (configType === '單打' || configType === '雙打') {
                console.log(`從 points_config 獲取類型: ${configType}`);
                return configType;
              }
              
              // 如果沒有從配置獲取到，則檢查當前值
              // 先檢查是否已經是中文格式
              if (type === '單打' || type === '雙打') {
                console.log(`類型已是中文格式: ${type}`);
                return type;
              }
              // 如果是英文格式，轉換為中文
              if (type.toLowerCase() === 'singles') {
                console.log('英文單打轉中文');
                return '單打';
              }
              if (type.toLowerCase() === 'doubles') {
                console.log('英文雙打轉中文');
                return '雙打';
              }
              // 如果都不是，則根據內容判斷
              if (type.includes('單')) {
                console.log(`包含單字: ${type}`);
                return '單打';
              }
              if (type.includes('雙')) {
                console.log(`包含雙字: ${type}`);
                return '雙打';
              }
              // 預設為單打
              console.log('無法識別的比賽類型:', type);
              return '單打';
            };
            
            const matchTypeDisplay = getMatchTypeDisplay(detail.match_type);
            
            // 決定可選最大人數
            const maxMembers = matchTypeDisplay === '雙打' ? 2 : 1;
            const matchDetailKey = `${detail.match_detail_id}`;
            
            return (
              <div key={detail.match_detail_id} className="mb-6 p-4 border rounded">
                <h3 className="font-bold mb-2">
                  比賽項目 {detail.sequence}: {matchTypeDisplay}
                </h3>
                
                <div className="mb-4">
                  <label className="block mb-2">選擇出賽隊員 (最多{maxMembers}人):</label>
                  <select
                    multiple
                    value={selectedMembers[matchDetailKey] || []}
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                      const selectedOptions = Array.from(
                        e.target.selectedOptions,
                        option => option.value
                      );
                      handleMemberSelection(matchDetailKey, selectedOptions, maxMembers);
                    }}
                    className="w-full p-2 border rounded"
                    size={5} // 顯示5行選項
                  >
                    {teamMembers.map((member: TeamMember) => {
                      // 檢查該選手是否已在其他項目中被選中
                      // 由於 TypeScript 環境問題，這裡的類型推斷可能不穩定，因此添加顯式類型斷言
                      const isSelectedInOtherItem = (Object.entries(selectedMembers) as [string, string[]][]).some(
                        ([key, members]) => key !== matchDetailKey && members.includes(member.member_id)
                      );
                      
                      return (
                        <option 
                          key={member.member_id} 
                          value={member.member_id}
                          style={isSelectedInOtherItem ? {backgroundColor: "#FEF3C7", fontWeight: "500"} : {}}
                        >
                          {member.name} {member.status === 'captain' ? '(隊長)' : ''}
                          {isSelectedInOtherItem ? ' (已選)' : ''}
                        </option>
                      );
                    })}
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