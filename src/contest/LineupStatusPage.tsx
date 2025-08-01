import React, { useEffect, useState, useContext } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { UserContext } from '../UserContext';
import { supabase } from '../supabaseClient';

interface LineupStatus {
  team1_name: string;
  team2_name: string;
  match_id: number;
  team1_id: number;
  team2_id: number;
  contest_id: number;
  bracket_round?: number; // 添加 bracket_round 字段
}

const LineupStatusPage: React.FC = () => {
  const { contestId } = useParams<{ contestId: string }>();
  const navigate = useNavigate();
  const { user } = useContext(UserContext) ?? { user: null };
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lineups, setLineups] = useState<LineupStatus[]>([]);
  const [contestName, setContestName] = useState('');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [userCaptainTeams, setUserCaptainTeams] = useState<Set<number>>(new Set());
  const [currentUserName, setCurrentUserName] = useState<string>('');
  const [localStorageUser, setLocalStorageUser] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [maxBracketRound, setMaxBracketRound] = useState<number | null>(null); // 添加最大轮次状态


  useEffect(() => {
    if (contestId) {
      // 先獲取用戶身份資訊
      getCurrentUserInfo();
      fetchContestName();
      fetchLineupStatus();
    }
    // eslint-disable-next-line
  }, [contestId]);

  // 獲取當前用戶資訊
  const getCurrentUserInfo = () => {
    try {
      // 從 localStorage 取得用戶資訊（與 BattleRoomPage 保持一致）
      const storedUser = JSON.parse(localStorage.getItem('loginUser') || '{}');
      setLocalStorageUser(storedUser);
      
      console.log('從 localStorage 獲取的用戶資訊:', storedUser);
      
      // 設置用戶名稱
      const username = storedUser.userName || storedUser.username || storedUser.name || '';
      setCurrentUserName(username);
      
      // 設置管理員狀態
      const isUserAdmin = storedUser.role === 'admin' || storedUser.is_admin === true;
      setIsAdmin(isUserAdmin);
      
      // 設置 member_id
      if (storedUser.member_id) {
        setCurrentUserId(storedUser.member_id);
        console.log('設置用戶 member_id:', storedUser.member_id);
        return;
      }
      
      // 優先從 UserContext 取得
      if (user?.member_id) {
        setCurrentUserId(user.member_id);
        console.log('從 UserContext 取得 member_id:', user.member_id);
        return;
      }
      
      console.log('無法取得用戶 member_id');
    } catch (err) {
      console.error('解析用戶資訊錯誤:', err);
    }
  };

  // 取得比賽名稱
  const fetchContestName = async () => {
    try {
      const { data, error } = await supabase
        .from('contest')
        .select('contest_name')
        .eq('contest_id', contestId)
        .single();
      if (error) throw error;
      setContestName(data?.contest_name || '');
    } catch {
      setContestName('');
    }
  };

  // 取得名單狀態和相關資訊
  const fetchLineupStatus = async () => {
    setLoading(true);
    setError('');
    try {
      console.log('=== fetchLineupStatus 開始 ===');
      console.log('currentUserId:', currentUserId);
      
      // 1. 從 vw_lineupstatuspage 取得基本名單狀態（包含 bracket_round）
      const { data: lineupData, error: lineupError } = await supabase
        .from('vw_lineupstatuspage')
        .select('team1_name, team2_name, match_id, bracket_round')
        .eq('contest_id', contestId);
      
      console.log('lineupData 查詢結果:', lineupData);
      
      if (lineupError) throw lineupError;

      if (!lineupData || lineupData.length === 0) {
        setLineups([]);
        setLoading(false);
        return;
      }

      // 2. 找出最大的 bracket_round（如果有淘汰賽資料）
      const bracketRounds = lineupData
        .map((item: any) => item.bracket_round)
        .filter((round: any) => round !== null && round !== undefined);
      
      let filteredLineupData = lineupData;
      
      if (bracketRounds.length > 0) {
        // 有淘汰賽資料，找出最大輪次
        const maxRound = Math.max(...bracketRounds);
        setMaxBracketRound(maxRound);
        console.log('檢測到淘汰賽，最大輪次:', maxRound);
        
        // 只保留最大輪次的比賽，或者沒有 bracket_round 的比賽（循環賽）
        filteredLineupData = lineupData.filter((item: any) => 
          item.bracket_round === null || item.bracket_round === maxRound
        );
        
        console.log('過濾後的 lineupData（只保留最大輪次）:', filteredLineupData);
      } else {
        // 沒有淘汰賽資料，顯示所有比賽
        setMaxBracketRound(null);
        console.log('沒有檢測到淘汰賽資料，顯示所有比賽');
      }

      // 3. 從 contest_match 取得完整的比賽資訊
      const matchIds = filteredLineupData.map((item: any) => item.match_id);
      console.log('查詢 contest_match，matchIds:', matchIds);
      
      const { data: matchData, error: matchError } = await supabase
        .from('contest_match')
        .select('match_id, team1_id, team2_id, contest_id')
        .in('match_id', matchIds);
      
      console.log('matchData 查詢結果:', matchData);
      
      if (matchError) throw matchError;

      // 4. 合併資料
      const combinedData: LineupStatus[] = filteredLineupData.map((lineup: any) => {
        const matchInfo = matchData?.find((match: any) => match.match_id === lineup.match_id);
        return {
          team1_name: lineup.team1_name,
          team2_name: lineup.team2_name,
          match_id: lineup.match_id,
          team1_id: matchInfo?.team1_id || 0,
          team2_id: matchInfo?.team2_id || 0,
          contest_id: matchInfo?.contest_id || parseInt(contestId as string),
          bracket_round: lineup.bracket_round
        };
      });

      console.log('合併後的資料 combinedData:', combinedData);
      setLineups(combinedData);
      
      // 5. 如果有用戶ID，查詢用戶是哪些隊伍的隊長
      console.log('檢查是否調用 fetchUserCaptainTeams:', {
        currentUserId,
        combinedDataLength: combinedData.length
      });
      
      if (currentUserId && combinedData.length > 0) {
        console.log('即將調用 fetchUserCaptainTeams...');
        await fetchUserCaptainTeams(combinedData);
      } else {
        console.log('跳過 fetchUserCaptainTeams，原因:', {
          hasCurrentUserId: !!currentUserId,
          hasCombinedData: combinedData.length > 0
        });
      }
      
    } catch (err: any) {
      setError('載入資料失敗');
      console.error('fetchLineupStatus error:', err);
    } finally {
      setLoading(false);
    }
  };

  // 查詢用戶是哪些隊伍的隊長 - 修正後的版本
  const fetchUserCaptainTeams = async (lineupData: LineupStatus[]) => {
    if (!currentUserId) {
      console.log('沒有 currentUserId，跳過隊長查詢');
      return;
    }
    
    try {
      console.log('開始查詢用戶隊長身份:', {
        member_id: currentUserId,
        contest_id: contestId
      });
      
      // 直接查詢用戶在所有比賽中是否為隊長
      const { data: captainData, error: captainError } = await supabase
        .from('contest_team_member')
        .select('contest_team_id')
        .eq('member_id', currentUserId)
        .eq('status', 'captain');
        
      console.log('查詢隊長的SQL等同於:', `
        SELECT contest_team_id 
        FROM contest_team_member 
        WHERE member_id = '${currentUserId}' 
          AND status = 'captain'
      `);

      if (captainError) {
        console.error('查詢隊長資訊錯誤:', captainError);
        return;
      }
      
      console.log('查詢隊長的原始結果:', captainData);
      
      if (captainData && captainData.length > 0) {
        // 過濾出屬於當前比賽的隊伍
        const currentContestTeamIds = new Set<number>();
        lineupData.forEach(lineup => {
          currentContestTeamIds.add(lineup.team1_id);
          currentContestTeamIds.add(lineup.team2_id);
        });
        
        console.log('當前比賽的所有隊伍ID:', Array.from(currentContestTeamIds));
        
        // 找出用戶在當前比賽中擔任隊長的隊伍
        const relevantCaptainTeams = captainData
          .filter((item: any) => currentContestTeamIds.has(item.contest_team_id))
          .map((item: any) => item.contest_team_id);
          
        console.log('用戶在當前比賽中擔任隊長的隊伍:', relevantCaptainTeams);
        
        if (relevantCaptainTeams.length > 0) {
          const captainTeamIds = new Set(relevantCaptainTeams);
          setUserCaptainTeams(captainTeamIds);
          console.log('最終設置的隊長隊伍ID:', Array.from(captainTeamIds));
        } else {
          console.log('用戶不是當前比賽中任何隊伍的隊長');
        }
      } else {
        console.log('用戶不是任何隊伍的隊長');
      }
      
    } catch (err) {
      console.error('fetchUserCaptainTeams error:', err);
    }
  };

  // 重新執行 fetchLineupStatus 當 currentUserId 改變時
  useEffect(() => {
    console.log('=== currentUserId useEffect 觸發 ===');
    console.log('currentUserId:', currentUserId);
    console.log('lineups.length:', lineups.length);
    
    if (currentUserId && lineups.length > 0) {
      console.log('條件符合，調用 fetchUserCaptainTeams...');
      fetchUserCaptainTeams(lineups);
    } else {
      console.log('條件不符合，跳過 fetchUserCaptainTeams');
    }
  }, [currentUserId, lineups]);

  const goBackToContest = () => {
    window.history.back();
  };

  // 判斷是否顯示編輯按鈕
  const shouldShowEditButton = (teamName: string, teamId: number): boolean => {
    // 檢查是否未編排且用戶是該隊隊長
    return teamName.includes('未編排') && userCaptainTeams.has(teamId);
  };

  // 導航到編輯名單頁面
  const navigateToLineupEditor = (matchId: number, teamId: number) => {
    console.log('準備導航到編輯名單頁面:', { matchId, teamId });
    
    // 嘗試幾種可能的路由路徑
    const possiblePaths = [
      `/lineup-editor?match_id=${matchId}&team_id=${teamId}`,
      `/contest/${contestId}/lineup-editor?match_id=${matchId}&team_id=${teamId}`,
      `/LineupEditorPage?match_id=${matchId}&team_id=${teamId}`
    ];
    
    console.log('可能的路由路徑:', possiblePaths);
    
    // 先嘗試第一個路徑
    try {
      navigate(`/lineup-editor?match_id=${matchId}&team_id=${teamId}`);
    } catch (error) {
      console.error('導航失敗:', error);
      // 如果失敗，嘗試相對路徑
      console.log('嘗試備用路徑...');
      window.location.href = `/lineup-editor?match_id=${matchId}&team_id=${teamId}`;
    }
  };

  // 解析隊伍名稱與狀態，換行顯示
  const renderTeamCell = (teamName: string, teamId: number, matchId: number) => {
    const isUnarranged = teamName.includes('未編排');
    const showEditButton = shouldShowEditButton(teamName, teamId);
    
    return (
      <div className="flex items-center justify-between">
        <span className={`font-extrabold text-xl ${isUnarranged ? 'text-red-600' : 'text-green-700'}`}>
          {teamName}
        </span>
        {showEditButton && (
          <button
            onClick={() => navigateToLineupEditor(matchId, teamId)}
            className="ml-3 px-3 py-1 bg-blue-500 text-white text-sm rounded hover:bg-blue-600 transition"
          >
            編輯名單
          </button>
        )}
      </div>
    );
  };

  // 取得標題文字
  const getTitle = () => {
    let title = contestName ? `${contestName} 名單狀態` : '名單狀態';
    if (maxBracketRound !== null) {
      title += ` (第${maxBracketRound}輪)`;
    }
    return title;
  };

  return (
    <div className="max-w-3xl mx-auto p-6 bg-gradient-to-br from-blue-50 to-white min-h-screen rounded-xl shadow-xl">
      {/* 用戶資訊區塊 */}
      <div className="p-4 bg-gray-100 flex justify-end items-center mb-4 rounded-lg">
        <span className="text-gray-600">
          登入者：{localStorageUser?.userName || currentUserName || '訪客'}
          {localStorageUser?.team_name ? `（${localStorageUser.team_name}隊）` : ''}
          {isAdmin && <span className="ml-2 text-blue-600 font-semibold">[管理員]</span>}
        </span>
      </div>

      
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-blue-900">
          {getTitle()}
        </h1>
        <button
          onClick={goBackToContest}
          className="px-5 py-2 bg-blue-100 text-blue-800 rounded-lg shadow-sm hover:bg-blue-200 transition font-semibold text-base"
        >
          返回比賽
        </button>
      </div>

      {loading && <div className="text-center py-10 text-lg text-blue-700">載入中...</div>}
      {!loading && error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4 text-lg">
          {error}
        </div>
      )}
      {!loading && !error && lineups.length === 0 && (
        <div className="text-center py-10 text-gray-500 text-lg">沒有資料</div>
      )}
      {!loading && !error && lineups.length > 0 && (
        <div className="bg-white shadow-lg rounded-2xl overflow-hidden border border-blue-100">
          <table className="min-w-full">
            <thead className="bg-blue-50">
              <tr>
                <th className="px-8 py-5 text-left text-xl font-bold text-blue-900 tracking-wider">隊伍1</th>
                <th className="px-4 py-5 text-center text-xl font-bold text-blue-900 tracking-wider">VS</th>
                <th className="px-8 py-5 text-left text-xl font-bold text-blue-900 tracking-wider">隊伍2</th>
              </tr>
            </thead>
            <tbody>
              {lineups.map((item, idx) => (
                <tr key={`${item.match_id}-${idx}`} className="hover:bg-blue-50 transition">
                  <td className="px-8 py-6 align-top border-b border-blue-100">
                    {renderTeamCell(item.team1_name, item.team1_id, item.match_id)}
                  </td>
                  <td className="px-4 py-6 text-center text-2xl font-extrabold text-blue-700 border-b border-blue-100">VS</td>
                  <td className="px-8 py-6 align-top border-b border-blue-100">
                    {renderTeamCell(item.team2_name, item.team2_id, item.match_id)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      
      {/* 說明區域 */}
      {!loading && !error && userCaptainTeams.size > 0 && (
        <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <h3 className="font-bold text-blue-800 mb-2">隊長提示</h3>
          <p className="text-sm text-blue-700">
            您是隊長，可以點擊「編輯名單」按鈕來安排尚未編排的隊伍出賽名單。
            {maxBracketRound !== null && `目前顯示的是淘汰賽第${maxBracketRound}輪的比賽。`}
          </p>
        </div>
      )}
    </div>
  );
};

export default LineupStatusPage;