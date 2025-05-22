import React, { useState, useEffect, useContext } from 'react';
import { BellIcon, XIcon, CalendarIcon } from 'lucide-react';
import ChallengeListPage from './ChallengeListPage';
import { BrowserRouter as Router, Routes, Route, Link, useNavigate } from 'react-router-dom';
import DoubleGame from './double_game';
import SingleGame from './single_game';
import MemberManagement from './MemberManagement';
import { supabase } from './supabaseClient';
import LoginModal from './LoginModal';
import ChangePasswordModal from './ChangePasswordModal';
import BattleRecords from './BattleRecords';
import CourtUsagePage from './CourtUsagePage'; 
import CourtManagement from './CourtManagement';
import CourtIntroPage from './CourtIntroPage';
import { UserProvider, UserContext } from './UserContext';
import ChallengeCreatePage from './ChallengeCreatePage';
import CreateContestPage from './contest/CreateContestPage';
import ContestListPage from './contest/ContestListPage';
import ContestJoinPage from './contest/ContestJoinPage';
import EditContestPage from './contest/EditContestPage';
import ContestControlPage from './contest/ContestControlPage';
import BattleRoomPage from './contest/BattleRoomPage';
import NewPersonalInfo from './personal/NewPersonalInfo';
import LineupEditorPage from './contest/LineupEditorPage';
import ContestResultsPage from './contest/ContestResultsPage';
import LineupStatusPage from './contest/LineupStatusPage';
import ContestTableView from './contest/ContestTableView';

// 版本信息
const CURRENT_VERSION = "a.20";

// 創建會員資料表的函數
async function createMembersTable() {
  try {
    // 嘗試運行一個查詢來檢查表是否存在
    const { error } = await supabase
      .from('members')
      .select('count')
      .limit(1);
    
    // 如果表不存在，創建表
    if (error && error.code === '42P01') {
      // 使用 SQL 創建表
      const { error: createError } = await supabase.rpc('exec_sql', {
        sql_query: `
          CREATE TABLE public.members (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            member_id TEXT UNIQUE NOT NULL,
            join_date DATE NOT NULL DEFAULT CURRENT_DATE,
            name TEXT NOT NULL,
            phone TEXT,
            remark TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          );
        `
      });
      
      if (createError) {
        console.error('創建會員資料表失敗:', createError);
        return false;
      }
      console.log('會員資料表創建成功');
      return true;
    }
    
    console.log('會員資料表已存在');
    return !error;
  } catch (error) {
    console.error('檢查會員資料表失敗:', error);
    return false;
  }
}

// 新增管理員專區頁面
function AdminArea({ currentLoggedInUser }) {
  const [teamName, setTeamName] = useState('');

  // 根據 team_id 查詢團隊名稱
  useEffect(() => {
    const fetchTeamName = async () => {
      if (currentLoggedInUser?.team_id) {
        const { data, error } = await supabase
          .from('courts')
          .select('name')
          .eq('team_id', currentLoggedInUser.team_id)
          .maybeSingle();
        
        if (!error && data) {
          setTeamName(data.name);
        } else {
          setTeamName(currentLoggedInUser.team_id); // 如果查不到就顯示 team_id
        }
      }
    };
    fetchTeamName();
  }, [currentLoggedInUser?.team_id]);

  return (
    <div className="flex flex-col items-center mt-10">
      {/* 登入者資訊顯示 */}
      {currentLoggedInUser && (
        <div className="mb-6 p-4 bg-blue-50 rounded-lg border border-blue-200 w-full max-w-md">
          <div className="text-center">
            <div className="text-lg font-semibold text-blue-800">
              登入者：{currentLoggedInUser.name}
            </div>
            <div className="text-sm text-blue-600">
              團隊：{teamName || '載入中...'}
            </div>
            <div className="text-sm text-blue-600">
              角色：{currentLoggedInUser.role}
            </div>
            <div className="text-xs text-gray-500">
              會員ID：{currentLoggedInUser.member_id}
            </div>
          </div>
        </div>
      )}

      <h2 className="text-2xl font-bold mb-6">管理員專區</h2>
      <div className="flex flex-col gap-4 w-64">
        <Link to="/members">
          <button className="w-full py-3 bg-purple-500 text-white rounded hover:bg-purple-600">會員管理</button>
        </Link>
        <Link to="/admin/court">
          <button className="w-full py-3 bg-indigo-500 text-white rounded hover:bg-indigo-600">球場管理</button>
        </Link>
        <Link to="/admin/usage">
          <button className="w-full py-3 bg-blue-500 text-white rounded hover:bg-blue-600">球場使用分析</button>
        </Link>
        {currentLoggedInUser?.role === 'admin' && (
          <>
            <Link to="/contest/create">
              <button className="w-full py-3 bg-blue-600 text-white rounded hover:bg-blue-700">
                建立比賽
              </button>
            </Link>
            <Link to="/contest-control">
              <button className="w-full py-3 bg-green-500 text-white rounded hover:bg-green-600">
                賽程控制區
              </button>
            </Link>
          </>
        )}
      </div>
      
      {/* 返回主選單按鈕 */}
      <div className="mt-6">
        <Link to="/" className="px-6 py-2 bg-gray-500 text-white rounded hover:bg-gray-600">
          返回主選單
        </Link>
      </div>
    </div>
  );
}

// 新增賽程邀約處理頁面
function ContestInvitationsPage() {
  const { user } = useContext(UserContext) ?? { user: null };
  const [invitations, setInvitations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [teamMembers, setTeamMembers] = useState({}); // { contest_team_id: [member_name, ...] }

  useEffect(() => {
    const fetchInvitations = async () => {
      setLoading(true);
      if (!user?.member_id) {
        setInvitations([]);
        setTeamMembers({});
        setLoading(false);
        return;
      }
      // 巢狀 join contest_team 與 contest，取得隊伍名稱與比賽名稱
      const { data, error } = await supabase
        .from('contest_team_member')
        .select(`
          contest_team_id,
          member_id,
          member_name,
          status,
          contest_team:contest_team_id (
            team_name,
            contest:contest_id (
              contest_name,
              rule_text
            )
          )
        `)
        .eq('member_id', user.member_id)
        .eq('status', 'invited');
      console.log('邀約 join 結果', data, error);
      setInvitations(data || []);
      setLoading(false);
      // 查詢所有邀約隊伍的已加入成員
      if (data && data.length > 0) {
        const teamIds = data.map(i => i.contest_team_id);
        fetchTeamMembers(teamIds);
      } else {
        setTeamMembers({});
      }
    };
    const fetchTeamMembers = async (teamIds) => {
      if (!teamIds || teamIds.length === 0) return;
      const { data, error } = await supabase
        .from('contest_team_member')
        .select('contest_team_id, member_name')
        .in('contest_team_id', teamIds)
        .eq('status', 'accepted');
      console.log('隊伍已加入成員查詢', data, error);
      // 整理成 { contest_team_id: [member_name, ...] }
      const membersMap = {};
      (data || []).forEach(row => {
        if (!membersMap[row.contest_team_id]) membersMap[row.contest_team_id] = [];
        membersMap[row.contest_team_id].push(row.member_name);
      });
      setTeamMembers(membersMap);
    };
    fetchInvitations();
  }, [user?.member_id]);

  // 處理接受邀約
  const handleAccept = async (contest_team_id, member_id) => {
    await supabase
      .from('contest_team_member')
      .update({ status: 'accepted', responded_at: new Date() })
      .eq('contest_team_id', contest_team_id)
      .eq('member_id', member_id);
    setInvitations(invitations.filter(i => !(i.contest_team_id === contest_team_id && i.member_id === member_id)));
  };
  // 處理拒絕邀約
  const handleReject = async (contest_team_id, member_id) => {
    await supabase
      .from('contest_team_member')
      .update({ status: 'rejected', responded_at: new Date() })
      .eq('contest_team_id', contest_team_id)
      .eq('member_id', member_id);
    setInvitations(invitations.filter(i => !(i.contest_team_id === contest_team_id && i.member_id === member_id)));
  };

  return (
    <div className="p-6 max-w-xl mx-auto">
      <h2 className="text-2xl font-bold mb-4">我的賽程邀約</h2>
      {loading ? <div>載入中...</div> : (
        invitations.length === 0 ? <div>目前沒有新的賽程邀約。</div> : (
          <ul className="space-y-4">
            {invitations.map(invite => (
              <li key={invite.contest_team_id} className="border rounded p-4 flex flex-col gap-2">
                <div className="flex justify-between items-center">
                  <div>
                    <div>邀約隊伍：{invite.contest_team?.team_name || '未知隊伍'}</div>
                    <div>比賽名稱：{invite.contest_team?.contest?.contest_name || '未知比賽'}</div>
                    <div>比賽規則：{invite.contest_team?.contest?.rule_text || '無'}</div>
                    <div>成員：{invite.member_name}</div>
                  </div>
                  <div className="flex gap-2">
                    <button className="px-3 py-1 bg-green-500 text-white rounded" onClick={() => handleAccept(invite.contest_team_id, invite.member_id)}>接受</button>
                    <button className="px-3 py-1 bg-red-500 text-white rounded" onClick={() => handleReject(invite.contest_team_id, invite.member_id)}>拒絕</button>
                  </div>
                </div>
                {/* 顯示該隊伍已加入成員 */}
                <div className="text-sm text-gray-700 mt-2">
                  <span>已加入成員：</span>
                  {teamMembers[invite.contest_team_id]?.length > 0
                    ? teamMembers[invite.contest_team_id].join('、')
                    : '暫無'}
                </div>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}

function App() {
    // 初始化 currentLoggedInUser 狀態，嘗試從 localStorage 讀取
    const [currentLoggedInUser, setCurrentLoggedInUser] = useState(() => {
        const user = localStorage.getItem('loginUser');
        return user ? JSON.parse(user) : null;
    });
    
    // 新增 teamName 狀態
    const [teamName, setTeamName] = useState('');
    
    // 更新 currentLoggedInUser 的函數，同時更新 localStorage
    const updateCurrentLoggedInUser = (user) => {
        setCurrentLoggedInUser(user);
        if (user) {
            localStorage.setItem('loginUser', JSON.stringify(user));
        } else {
            localStorage.removeItem('loginUser');
        }
    };

  useEffect(() => {
    const initDb = async () => {
      try {
        const result = await createMembersTable();
        if (result) {
          console.log('會員資料表設置完成');
        }
      } catch (error) {
        console.error('初始化資料庫失敗:', error);
      }
    };
    
    initDb();
  }, []);

  // 修改: 根據登入者的 team_id 查詢團隊名稱
  useEffect(() => {
    const fetchTeamName = async () => {
      if (currentLoggedInUser?.team_id) {
        const { data, error } = await supabase
          .from('courts')
          .select('name')
          .eq('team_id', currentLoggedInUser.team_id)
          .maybeSingle();
        
        if (!error && data) {
          setTeamName(data.name);
          // 更新 currentLoggedInUser 加入 team_name
          const updatedUser = { ...currentLoggedInUser, team_name: data.name };
          setCurrentLoggedInUser(updatedUser);
          localStorage.setItem('loginUser', JSON.stringify(updatedUser));
        } else {
          setTeamName(currentLoggedInUser.team_id); // 如果查不到就顯示 team_id
        }
      } else {
        setTeamName('');
      }
    };
    fetchTeamName();
  }, [currentLoggedInUser?.team_id]);

  const { user } = useContext(UserContext) ?? { user: null };
  const [unreadCount, setUnreadCount] = useState(0);

  // 取得 team_name (這個函數保留，但主要邏輯已移到上面的 useEffect)
  const fetchTeamNameByMemberId = async (memberId: string) => {
    if (!memberId) return '';
    const teamId = memberId[0];
    const { data, error } = await supabase
      .from('courts')
      .select('name')
      .eq('team_id', teamId)
      .maybeSingle();
    return data?.name || '';
  };

  // 修改: 取得未讀挑戰數（依據 vw_challenge_unread_count，需同時比對 name 與 team_name）
  const fetchUnreadCount = async (userName: string, userTeamName: string) => {
    if (!userName || !userTeamName) {
      setUnreadCount(0);
      return;
    }
    const { data, error } = await supabase
      .from('vw_challenge_unread_count')
      .select('unread_count')
      .eq('name', userName)
      .eq('team_name', userTeamName)
      .maybeSingle();

    if (!error && data && typeof data.unread_count === 'number') {
      setUnreadCount(data.unread_count);
    } else {
      setUnreadCount(0);
    }
  };

  // 只要登入者名字或隊伍名稱有變動就查詢
  useEffect(() => {
    if (currentLoggedInUser?.name && teamName) {
      fetchUnreadCount(currentLoggedInUser.name, teamName);
    } else {
      setUnreadCount(0);
    }
  }, [currentLoggedInUser?.name, teamName]);

  const [invitationCount, setInvitationCount] = useState(0); // 回復為 0

  useEffect(() => {
    const fetchInvitations = async () => {
      if (!currentLoggedInUser?.member_id) {
        setInvitationCount(0);
        return;
      }
      const { data, error } = await supabase
        .from('vw_member_invited_count')
        .select('invited_count')
        .eq('member_id', currentLoggedInUser.member_id);
      console.log('vw_member_invited_count 查詢結果:', data);
      if (!error && data && Array.isArray(data)) {
        // 將所有 invited_count 加總
        const total = data.reduce((sum, row) => sum + (row.invited_count || 0), 0);
        console.log('加總後 invitationCount:', total);
        setInvitationCount(total);
      } else {
        setInvitationCount(0);
      }
    };
    fetchInvitations();
  }, [currentLoggedInUser?.member_id]);

  return (
    <UserProvider user={currentLoggedInUser}>
      <div>
        <Router>
          <Routes>
            <Route path="/" element={
              <>
                <Menu 
                  currentLoggedInUser={currentLoggedInUser} 
                  setCurrentLoggedInUser={setCurrentLoggedInUser} 
                  unreadCount={unreadCount}
                  invitationCount={invitationCount}
                  teamName={teamName}
                />
              </>
            } />
            <Route path="/game" element={<DoubleGame />} />
            <Route path="/double_game" element={<DoubleGame />} />
            <Route path="/single" element={<SingleGame currentLoggedInUser={currentLoggedInUser} />} />
            <Route path="/single_game" element={<SingleGame currentLoggedInUser={currentLoggedInUser} />} />
            <Route path="/members" element={<MemberManagement loginUser={currentLoggedInUser} />} />
            <Route path="/records" element={<BattleRecords />} />
            {/* 移除舊版個人資訊路由 */}
            <Route path="/admin" element={<AdminArea currentLoggedInUser={currentLoggedInUser} />} />
            <Route path="/admin/court" element={<CourtManagement />} />
            <Route path="/admin/usage" element={<CourtUsagePage />} />
            <Route path="/court-intro" element={<CourtIntroPage />} />
            <Route path="/challenges" element={<ChallengeListPage fetchUnreadCount={() => fetchUnreadCount(currentLoggedInUser?.name, teamName)} />} />
            <Route path="/create-challenge" element={<ChallengeCreatePage />} />
            <Route path="/contest/create" element={<CreateContestPage />} />
            <Route path="/contests" element={<ContestListPage />} />
            <Route path="/contest/:contest_id/join" element={<ContestJoinPage />} />
            <Route path="/contest/edit/:contest_id" element={<EditContestPage />} />
            <Route path="/contest-invitations" element={<ContestInvitationsPage />} />
            <Route path="/contest-control" element={<ContestControlPage />} />
            <Route path="/contest/lineup-editor" element={<LineupEditorPage />} />
            <Route path="/lineup-editor" element={<LineupEditorPage />} />
            <Route path="/contest/:contestId/battleroom" element={<BattleRoomPage />} />
            <Route path="/contest/:contestId/results" element={<ContestResultsPage />} />
            <Route path="/contest/:contestId/lineup-status" element={<LineupStatusPage />} />
            <Route path="/new-personal-info" element={<NewPersonalInfo />} />
            <Route path="/contest/:contestId/table-view" element={<ContestTableView />} />

          </Routes>
        </Router>
      </div>
    </UserProvider>
  );
}

function Menu({ currentLoggedInUser, setCurrentLoggedInUser, unreadCount, invitationCount, teamName }) {
  const navigate = useNavigate();
  const { currentUser } = useContext(UserContext) ?? { currentUser: null };
  const [showLogin, setShowLogin] = useState(false);
  const [showChangePwd, setShowChangePwd] = useState(false);
  const isGuest = !currentLoggedInUser;
 
  useEffect(() => {
    if (currentLoggedInUser && currentLoggedInUser.must_change_password) {
      setShowChangePwd(true);
    }
  }, [currentLoggedInUser]);

  const handlePwdChangeSuccess = () => {
    setCurrentLoggedInUser({ ...currentLoggedInUser, must_change_password: false });
    setShowChangePwd(false);
    alert('密碼修改成功，請繼續使用系統！');
  };

  const handleLogout = () => {
    setCurrentLoggedInUser(null);
    localStorage.removeItem('loginUser');
    window.location.href = '/';
  };

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-gray-100">
      <div className="mb-6">
        <svg viewBox="0 0 180 120" width="180" height="120" className="rounded-lg shadow-md bg-white">
          <rect x="30" y="20" width="120" height="80" rx="8" fill="#4c9eeb" stroke="#4c9eeb" strokeWidth="4"/>
          <line x1="90" y1="20" x2="90" y2="100" stroke="#fff" strokeWidth="2"/>
          <line x1="30" y1="60" x2="150" y2="60" stroke="#fff" strokeWidth="2"/>
          <ellipse cx="55" cy="60" rx="18" ry="24" fill="#ff6b6b" transform="rotate(-20 55 60)" />
          <ellipse cx="125" cy="60" rx="18" ry="24" fill="#222" transform="rotate(20 125 60)" />
          <circle cx="90" cy="42" r="8" fill="#fff" stroke="#fbbf24" strokeWidth="2"/>
          <rect x="60" y="70" width="60" height="28" rx="6" fill="#62d962" stroke="#fff" strokeWidth="2"/>
          <text x="78" y="90" textAnchor="middle" fill="#fff" fontSize="20" fontWeight="bold" fontFamily="Arial">10</text>
          <text x="90" y="90" textAnchor="middle" fill="#fff" fontSize="20" fontWeight="bold" fontFamily="Arial">:</text>
          <text x="102" y="90" textAnchor="middle" fill="#fff" fontSize="20" fontWeight="bold" fontFamily="Arial">10</text>
          <text x="90" y="16" textAnchor="middle" fill="#333" fontSize="14" fontWeight="bold" fontFamily="Arial">乒乓風雲</text>
        </svg>
      </div>      
      <h1 className="text-3xl font-bold mb-4">賽乒乓</h1>
    
      <div className="flex flex-col gap-4 w-64">
        <button
          className="w-full bg-blue-700 hover:bg-blue-800 text-white text-lg py-2 rounded"
          onClick={() => navigate('/court-intro')}
        >
          球場介紹
        </button>
        <button
          className="w-full bg-green-600 hover:bg-green-700 text-white text-lg py-2 rounded"
          onClick={() => navigate('/contests')}
        >
          參賽區
        </button>

        <div className="flex flex-row space-x-4">
          <button 
            className="flex-1 px-6 py-3 bg-blue-500 text-white text-center rounded-lg text-lg"
            onClick={() => window.location.href='/game'}
          >
            雙打計分
          </button>
          <button 
            className="flex-1 px-6 py-3 bg-orange-500 text-white text-center rounded-lg text-lg"
            onClick={() => navigate('/records')}
          >
            封神榜
          </button>
        </div>
        <div className="flex flex-row space-x-4">
          <button 
            className="flex-1 px-6 py-3 bg-green-500 text-white text-center rounded-lg text-lg"
            onClick={() => window.location.href='/single'}
          >
            單打計分
          </button>
          <button 
            className="flex-1 px-6 py-3 bg-indigo-500 text-white text-center rounded-lg text-lg"
            onClick={() => navigate('/new-personal-info')}
          >
            個人資訊
          </button>
        </div>
        <button 
          className="px-6 py-3 bg-purple-500 text-white text-center rounded-lg"
          disabled={isGuest || (currentLoggedInUser && currentLoggedInUser.must_change_password)}
          onClick={() => navigate('/admin')}
        >
          管理員專區
        </button>
        {!currentLoggedInUser ? (
          <button 
            className="px-6 py-3 bg-gray-700 text-white rounded-lg"
            onClick={() => setShowLogin(true)}
          >
            登入
          </button>
        ) : (
          <div className="text-green-700 font-bold">歡迎：{currentLoggedInUser.name}（{currentLoggedInUser.role}）</div>
        )}
      </div>

      {showLogin && (
        <LoginModal 
          setCurrentLoggedInUser={setCurrentLoggedInUser} 
          onClose={() => setShowLogin(false)} 
        />
      )}
      {showChangePwd && currentLoggedInUser && (
        <ChangePasswordModal
          memberId={currentLoggedInUser.member_id}
          onSuccess={handlePwdChangeSuccess}
          onCancel={() => {}} // 不允許取消
        />
      )}
      {currentLoggedInUser && (
        <button
          className="px-4 py-2 bg-red-500 text-white rounded absolute top-4 right-4 z-50"
          onClick={handleLogout}
        >
          登出
        </button>
      )}
      
      {/* 通知區塊：鈴鐺+行事曆 */}
      <div style={{ position: 'absolute', top: 4, left: 4, zIndex: 10, display: 'flex', alignItems: 'center', gap: '16px' }}>
        <div style={{ position: 'relative', cursor: 'pointer' }} onClick={() => navigate('/challenges')}>
          <BellIcon size={28} color="#f87171" />
          {unreadCount > 0 && (
            <span style={{
              position: 'absolute', top: -2, right: -6,
              background: 'red', color: 'white', borderRadius: '50%',
              minWidth: 18, height: 18, display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 700, padding: '0 5px', zIndex: 2
            }}>{unreadCount}</span>
          )}
        </div>
        <div style={{ position: 'relative', cursor: 'pointer', animation: invitationCount > 0 ? 'blink 1s infinite' : 'none' }} onClick={() => navigate('/contest-invitations')}>
          <CalendarIcon size={28} color="#60a5fa" />
          {invitationCount > 0 && (
            <span style={{
              position: 'absolute', top: -2, right: -6,
              background: '#2563eb', color: 'white', borderRadius: '50%',
              minWidth: 18, height: 18, display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 700, padding: '0 5px', zIndex: 2
            }}>{invitationCount}</span>
          )}
        </div>
        <style>{`
          @keyframes blink {
            0%, 100% { box-shadow: 0 0 0 0 #60a5fa; }
            50% { box-shadow: 0 0 8px 4px #60a5fa; }
          }
        `}</style>
      </div>

{/* 修改: 簡潔的登入者資訊 - 移至登出按鈕下方 */}
      {currentLoggedInUser && (
        <div style={{ 
          position: 'absolute', 
          top: '60px', 
          right: '16px', 
          background: 'rgba(240, 249, 255, 0.9)', 
          padding: '6px 12px', 
          borderRadius: '6px', 
          fontSize: '12px', 
          color: '#0c4a6e',
          zIndex: 10,
          backdropFilter: 'blur(4px)'
        }}>
          <div>{currentLoggedInUser.name}（{teamName || '載入中...'}）</div>
        </div>
      )}

      {/* 版本號 - 移到右下角 */}
      <div className="absolute bottom-4 right-4 text-gray-500">
        版本: {CURRENT_VERSION}
      </div>
    </div>
  );
}

export default App;