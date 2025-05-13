import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '../supabaseClient';

// 介面定義
interface Member {
  id: string;
  name: string;
  team_id: string;
  member_id?: string;
}

interface LoginUser {
  role: string;
  name?: string;
  team_id?: string;
  [key: string]: any;
}

interface MemberPointsMap {
  [memberId: string]: { 
    points: number; 
    rank: number 
  };
}

/**
 * 玩家管理 Hook
 * 提供玩家選擇、玩家資料管理以及場地交換相關功能
 */
export const usePlayerManagement = () => {
  // 會員選單狀態
  const [members, setMembers] = useState<Member[]>([]);
  // 新增：成員資料載入狀態
  const [membersLoading, setMembersLoading] = useState<boolean>(true);
  const [memberPointsMap, setMemberPointsMap] = useState<MemberPointsMap>({});
  const [redMember, setRedMember] = useState(''); // id
  const [greenMember, setGreenMember] = useState(''); // id
  const [blueMember, setBlueMember] = useState(''); // id
  const [yellowMember, setYellowMember] = useState(''); // id
  
  // 比賽詳情 ID 和來源標示
  const [isFromBattleroom, setIsFromBattleroom] = useState(false);
  const [matchDetailId, setMatchDetailId] = useState<string | null>(null);
  const [team1Members, setTeam1Members] = useState<string[]>([]);
  const [team2Members, setTeam2Members] = useState<string[]>([]);
  const [team1Id, setTeam1Id] = useState<string | null>(null);
  const [team2Id, setTeam2Id] = useState<string | null>(null);
  
  // 取得網址 query string 並自動帶入選手
  const location = useLocation();
  
  // 取得當前登入用戶
  const [currentLoggedInUser, setCurrentLoggedInUser] = useState<LoginUser | null>(null);
  
  // 初始化：從 localStorage 取得當前登入用戶
  useEffect(() => {
    const savedUser = localStorage.getItem('loginUser');
    if (savedUser) {
      try {
        const parsedUser = JSON.parse(savedUser);
        setCurrentLoggedInUser(parsedUser);
        console.log('當前登入用戶:', parsedUser.name, '團隊 ID:', parsedUser.team_id);
      } catch (e) {
        console.error('解析用戶數據錯誤:', e);
        setCurrentLoggedInUser(null);
      }
    }
    // 即使沒有登入用戶，也要嘗試載入 T 隊成員
    else {
      console.log('無登入用戶，預設使用 T 隊');
      setCurrentLoggedInUser(null);
      setMembersLoading(true);
    }
  }, []);
  
  // 檢查是否從戰況室進入，並獲取相關參數
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const fromBattleroom = params.get('from_battleroom');
    setIsFromBattleroom(fromBattleroom === 'true');
    console.log('DEBUG: 是否從戰況室進入:', fromBattleroom === 'true', location.search);
    
    // 獲取比賽詳情 ID
    const matchId = params.get('match_detail_id');
    if (matchId) {
      setMatchDetailId(matchId);
      console.log('DEBUG: 從戰況室進入，比賽詳情 ID:', matchId);
    } else {
      console.warn('DEBUG: 未找到 match_detail_id 參數!');
    }
    
    // 獲取隊伍成員姓名
    const team1MembersParam = params.get('team1_members');
    const team2MembersParam = params.get('team2_members');
    
    console.log('DEBUG: 原始隊伍參數：', {
      team1_members: team1MembersParam,
      team2_members: team2MembersParam
    });
    
    if (team1MembersParam) {
      try {
        const parsedMembers = JSON.parse(team1MembersParam);
        setTeam1Members(parsedMembers);
        console.log('DEBUG: 解析隊伍1成員成功:', parsedMembers);
      } catch (e) {
        console.error('DEBUG: 解析 team1_members 失敗:', e, team1MembersParam);
      }
    } else {
      console.warn('DEBUG: 無 team1_members 參數');
    }
    
    if (team2MembersParam) {
      try {
        const parsedMembers = JSON.parse(team2MembersParam);
        setTeam2Members(parsedMembers);
        console.log('DEBUG: 解析隊伍2成員成功:', parsedMembers);
      } catch (e) {
        console.error('DEBUG: 解析 team2_members 失敗:', e, team2MembersParam);
      }
    } else {
      console.warn('DEBUG: 無 team2_members 參數');
    }
    
    // 獲取隊伍 ID
    const team1IdParam = params.get('team1_id');
    const team2IdParam = params.get('team2_id');
    
    console.log('DEBUG: 隊伍 ID 參數：', {
      team1_id: team1IdParam,
      team2_id: team2IdParam
    });
    
    if (team1IdParam) {
      setTeam1Id(team1IdParam);
      console.log('DEBUG: 設置隊伍1 ID:', team1IdParam);
    } else {
      console.warn('DEBUG: 無 team1_id 參數');
    }
    
    if (team2IdParam) {
      setTeam2Id(team2IdParam);
      console.log('DEBUG: 設置隊伍2 ID:', team2IdParam);
    } else {
      console.warn('DEBUG: 無 team2_id 參數');
    }
    
  }, [location.search]);
  
  // 當 members 或 URL 參數變動時自動填充選手
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const p1 = params.get('player1');
    const p2 = params.get('player2');
    const p3 = params.get('player3');
    const p4 = params.get('player4');
    console.log('usePlayerManagement debug:', {
      url: location.search,
      player1: p1, player2: p2, player3: p3, player4: p4,
      members
    });
    
    // 比較靈活的匹配方式，檢查 id 或 member_id 的尾部是否相符
    if (members.length > 0) {
      console.log('所有成員:', members.map(m => ({ id: m.id, member_id: m.member_id, name: m.name })));
      
      const findMemberByShortId = (shortId: string | null) => {
        if (!shortId) return null;
        
        // 先完全匹配 member_id
        const exactMatch = members.find(m => m.member_id === shortId);
        if (exactMatch) {
          console.log(`找到完全匹配 ${shortId}:`, exactMatch);
          return exactMatch;
        }
        
        // 再完全匹配 id
        const idMatch = members.find(m => m.id === shortId);
        if (idMatch) {
          console.log(`找到ID匹配 ${shortId}:`, idMatch);
          return idMatch;
        }
        
        // 再查看 id 或 member_id 是否以這個短 ID 結尾
        const endMatch = members.find(m => 
          (m.id && m.id.endsWith(shortId)) || 
          (m.member_id && m.member_id.endsWith(shortId)));
        
        if (endMatch) {
          console.log(`找到尾部匹配 ${shortId}:`, endMatch);
          return endMatch;
        }
        
        console.log(`未找到成員 ${shortId}`);
        return null;
      };
      
      const red = findMemberByShortId(p1);
      const green = findMemberByShortId(p2);
      const blue = findMemberByShortId(p3);
      const yellow = findMemberByShortId(p4);
      
      console.log('find:', {red, green, blue, yellow});
      
      if (red) setRedMember(red.id);
      if (green) setGreenMember(green.id);
      if (blue) setBlueMember(blue.id);
      if (yellow) setYellowMember(yellow.id);
    }
  }, [members, location.search]);
  
  // 根據使用者登入狀態查詢會員和積分
  useEffect(() => {
    // 啟動載入狀態
    setMembersLoading(true);
    
    // 當用戶登入狀態變更時，進行日誌記錄
    if (currentLoggedInUser) {
      console.log('執行會員查詢 - 用戶登入狀態:', 
        '用戶名:', currentLoggedInUser.name, 
        '團隊 ID:', currentLoggedInUser.team_id);
    } else {
      console.log('執行會員查詢 - 無登入用戶，使用預設 T 隊');
    }
    
    // 根據來源不同區分查詢會員的方式
    const fetchMembersAndPoints = async () => {
      const isFromBattleRoom = location.search.includes('from_battleroom=true');
      console.log('當前來源狀態:', isFromBattleRoom ? '戰況室' : '一般挑戰賽');
      
      // 從URL獲取選手名稱
      const params = new URLSearchParams(location.search);
      const player1Name = params.get('player1_name');
      const player2Name = params.get('player2_name');
      const player3Name = params.get('player3_name');
      const player4Name = params.get('player4_name');
      
      // 從 sessionStorage 或 URL 參數獲取 member_id
      const player1MemberId = params.get('player1_member_id') || sessionStorage.getItem('player1_member_id');
      const player2MemberId = params.get('player2_member_id') || sessionStorage.getItem('player2_member_id');
      const player3MemberId = params.get('player3_member_id') || sessionStorage.getItem('player3_member_id');
      const player4MemberId = params.get('player4_member_id') || sessionStorage.getItem('player4_member_id');
      
      console.log('選手資訊:', {
        player1Name, player2Name, player3Name, player4Name,
        player1MemberId, player2MemberId, player3MemberId, player4MemberId
      });
      
      let allMembers: Member[] = [];
      
      // 先從 URL 參數獲取指定的 team_id
      // 使用已經存在的 params 變數
      const urlTeamId = params.get('team_id');
      
      // 再次確認用戶的 team_id，以保證獲取最新值
      const savedUser = localStorage.getItem('loginUser');
      let userTeamId: string | undefined;
      
      if (savedUser) {
        try {
          const freshUser = JSON.parse(savedUser);
          userTeamId = freshUser.team_id;
          console.log('從 localStorage 重新獲取用戶 team_id:', userTeamId);
        } catch (e) {
          console.error('解析 localStorage 用戶資訊失敗:', e);
        }
      }
      
      // 如果仍然未找到，嘗試使用 currentLoggedInUser 中的 team_id
      if (!userTeamId) {
        userTeamId = currentLoggedInUser?.team_id;
        console.log('使用 currentLoggedInUser 中的 team_id:', userTeamId);
      }
      
      // 未登入者預設可選T團隊
      if (!userTeamId) {
        userTeamId = 'T';
        console.log('未找到用戶 team_id，使用預設 T 隊');
      }
      
      // 決定要查詢的 team_id: 優先使用URL參數中的 team_id，如果沒有則使用用戶的 team_id
      const teamId = urlTeamId || userTeamId;
      
      console.log('查詢會員使用的 team_id:', teamId, 
        '(來源:', urlTeamId ? 'URL參數' : '登入用戶', ')');
      
      try {
        // 查詢指定 team_id 的會員
        const { data: membersData, error: membersError } = await supabase
          .from('members')
          .select('*')
          .eq('team_id', teamId);
        
        if (membersError) {
          console.error('查詢會員錯誤:', membersError);
          // 如果查詢失敗但使用的是 URL 參數指定的 team_id，嘗試使用用戶的 team_id
          if (urlTeamId && urlTeamId !== userTeamId) {
            console.log('嘗試使用用戶的 team_id 重新查詢:', userTeamId);
            const { data: fallbackData } = await supabase
              .from('members')
              .select('*')
              .eq('team_id', userTeamId);
            
            allMembers = fallbackData || [];
          }
        } else {
          allMembers = membersData || [];
          console.log('成功獲取會員數據:', allMembers.length, '筆', 
            '(team_id:', teamId, ')');
        }
        
        // 如果未找到會員且使用的不是 T 團隊，嘗試掛應查詢 T 團隊會員
        if (allMembers.length === 0 && teamId !== 'T') {
          console.log('未找到 ' + teamId + ' 團隊的會員，是否要嘗試查詢 T 團隊會員？');
          
          // 創建確認對話框顯示結果（使用結果晚間還是預設會員）
          const confirmSwitch = window.confirm(
            '未找到 ' + teamId + ' 團隊的會員。\n\n' + 
            '是否要使用 T 團隊的會員作為備選？\n' + 
            '「確定」：使用 T 團隊會員\n' + 
            '「取消」：不顯示候選會員'
          );
          
          if (confirmSwitch) {
            console.log('用戶確認使用 T 團隊會員');
            const { data: tTeamData } = await supabase
              .from('members')
              .select('*')
              .eq('team_id', 'T');
              
            if (tTeamData && tTeamData.length > 0) {
              allMembers = tTeamData;
              console.log('成功獲取 T 團隊會員:', tTeamData.length, '筆');
            }
          } else {
            console.log('用戶取消使用 T 團隊會員');
          }
        }
      } catch (e) {
        console.error('查詢會員時發生例外:', e);
      }
      
      setMembers(allMembers);
      
      // 查詢本月所有會員的積分
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth() + 1;
      const memberIds = allMembers.map((m: any) => m.id);
      if (memberIds.length > 0) {
        const { data: pointsData, error: pointsError } = await supabase
          .from('member_monthly_score_summary')
          .select('member_id, points')
          .eq('year', year)
          .eq('month', month)
          .in('member_id', memberIds)
          .order('points', { ascending: false });
        if (!pointsError && pointsData) {
          // 依積分高低產生排名
          const sorted = [...pointsData].sort((a, b) => (b.points ?? 0) - (a.points ?? 0));
          const map: { [memberId: string]: { points: number; rank: number } } = {};
          let lastPoints = null;
          let lastRank = 0;
          let realRank = 0;
          for (let i = 0; i < sorted.length; i++) {
            const row = sorted[i];
            realRank++;
            if (lastPoints === row.points) {
              map[row.member_id] = { points: row.points ?? 0, rank: lastRank };
            } else {
              map[row.member_id] = { points: row.points ?? 0, rank: realRank };
              lastPoints = row.points;
              lastRank = realRank;
            }
          }
          // 沒有積分資料的會員也補0分、最後一名
          for (const id of memberIds) {
            if (!map[id]) {
              map[id] = { points: 0, rank: sorted.length + 1 };
            }
          }
          setMemberPointsMap(map);
        } else {
          // 全部無資料
          const map: { [memberId: string]: { points: number; rank: number } } = {};
          for (const id of memberIds) {
            map[id] = { points: 0, rank: 1 };
          }
          setMemberPointsMap(map);
        }
      } else {
        setMemberPointsMap({});
      }
      
      // 完成載入，設置狀態為false
      setMembersLoading(false);
    };
    fetchMembersAndPoints();
  }, [currentLoggedInUser, location.search]); // 加入 currentLoggedInUser 作為完整依賴項，確保登入狀態變化時重新查詢
  
  // 取得團隊字母
  const getTeamLetter = (team_id?: string) => {
    if (!team_id) return 'T';
    return team_id.toUpperCase();
  };
  
  // 交換上方選手位置（紅綠交換）
  const swapTopPlayers = () => {
    const temp = redMember;
    setRedMember(greenMember);
    setGreenMember(temp);
  };
  
  // 交換下方選手位置（藍黃交換）
  const swapBottomPlayers = () => {
    const temp = blueMember;
    setBlueMember(yellowMember);
    setYellowMember(temp);
  };
  
  // 上下場地交換
  const swapCourt = () => {
    // 保存原始值
    const prevRed = redMember;
    const prevGreen = greenMember;
    const prevBlue = blueMember;
    const prevYellow = yellowMember;
    
    // 交換位置：上方變下方，下方變上方
    setRedMember(prevBlue);    // 上面左：原藍
    setGreenMember(prevYellow); // 上面右：原黃
    setBlueMember(prevRed);    // 下面左：原紅
    setYellowMember(prevGreen); // 下面右：原綠
  };
  
  // 特定位置交換玩家
  const swapPlayers = (position1: string, position2: string) => {
    const positions: Record<string, [string, React.Dispatch<React.SetStateAction<string>>]> = {
      'red': [redMember, setRedMember],
      'green': [greenMember, setGreenMember],
      'blue': [blueMember, setBlueMember],
      'yellow': [yellowMember, setYellowMember]
    };
    
    if (!positions[position1] || !positions[position2]) {
      console.error('無效的位置:', position1, position2);
      return;
    }
    
    const [member1, setMember1] = positions[position1];
    const [member2, setMember2] = positions[position2];
    
    setMember1(member2);
    setMember2(member1);
  };
  
  return {
    // 玩家狀態
    members,
    membersLoading,
    memberPointsMap,
    redMember,
    setRedMember,
    greenMember,
    setGreenMember,
    blueMember,
    setBlueMember,
    yellowMember,
    setYellowMember,
    
    // 比賽資訊
    isFromBattleroom,
    matchDetailId,
    team1Members,
    team2Members,
    team1Id,
    team2Id,
    
    // 當前使用者
    currentLoggedInUser,
    
    // 功能函數
    getTeamLetter,
    swapTopPlayers,
    swapBottomPlayers,
    swapCourt,
    swapPlayers
  };
};

export default usePlayerManagement;
