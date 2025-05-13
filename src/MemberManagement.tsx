import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from './supabaseClient';

// 會員資料介面
interface Member {
  id: string;
  member_id: string;
  name: string;
  phone: string;
  join_date: string;
  remark: string;
  grade: string; // 會員等級欄位
  team_id: string;
}

// loginUser 介面
interface LoginUser {
  role: string;
  name?: string;
  team_id?: string;
  [key: string]: any;
}

// ========== AddMemberForm 元件 ==========
const AddMemberForm: React.FC<{ onSuccess: () => void; onCancel: () => void; loginUser: LoginUser }> = ({ onSuccess, onCancel, loginUser }) => {
  const [member_id, setMemberId] = useState('系統自動產生');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  // 設定加入日期預設值為今天
  const todayStr = new Date().toISOString().slice(0, 10);
  const [join_date, setJoinDate] = useState(todayStr);
  const [remark, setRemark] = useState('');
  const [grade, setGrade] = useState('');
  const team_id = loginUser.team_id;

  useEffect(() => {
    const fetchNextMemberId = async () => {
      if (!team_id) {
        setMemberId('無team');
        return;
      }
      const { data, error } = await supabase
        .from('members')
        .select('member_id')
        .like('member_id', `${team_id}%`); // 移除 -
      if (error) {
        setMemberId(`${team_id}0001`); // 移除 -
        return;
      }
      let maxNum = 0;
      if (data && data.length > 0) {
        data.forEach((row: { member_id: string }) => {
          // 直接取 team_id 後面的流水號
          const numPart = row.member_id?.slice(team_id.length);
          const num = parseInt(numPart, 10);
          if (!isNaN(num) && num > maxNum) maxNum = num;
        });
      }
      const nextNum = (maxNum + 1).toString().padStart(4, '0');
      setMemberId(`${team_id}${nextNum}`); // 移除 -
    };
    fetchNextMemberId();
  }, [team_id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.from('members').insert([
      { member_id, name, phone, join_date, remark, grade, team_id }
    ]);
    if (error) {
      alert('新增失敗: ' + error.message);
    } else {
      onSuccess();
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50">
      <form className="bg-white p-6 rounded shadow-md w-96" onSubmit={handleSubmit}>
        <h2 className="text-lg font-bold mb-4">新增會員</h2>
        <div>
          <label htmlFor="member_id">會員編號</label>
          <input
            id="member_id"
            type="text"
            value={member_id}
            readOnly
            className="w-full mb-2 p-2 border rounded bg-gray-100"
          />
        </div>
        <div>
          <label htmlFor="team_id">Team</label>
          <input
            id="team_id"
            type="text"
            value={team_id}
            readOnly
            className="w-full mb-2 p-2 border rounded bg-gray-100"
          />
        </div>
        <div>
          <label htmlFor="name">姓名</label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            required
            className="w-full mb-2 p-2 border rounded"
          />
        </div>
        <div>
          <label htmlFor="phone">電話</label>
          <input
            id="phone"
            type="text"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            className="w-full mb-2 p-2 border rounded"
          />
        </div>
        <div>
          <label htmlFor="join_date">加入日期</label>
          <input
            id="join_date"
            type="date"
            value={join_date}
            onChange={e => setJoinDate(e.target.value)}
            required
            className="w-full mb-2 p-2 border rounded"
          />
        </div>
        <div>
          <label htmlFor="grade">級數</label>
          <input
            id="grade"
            type="text"
            value={grade}
            onChange={e => setGrade(e.target.value)}
            className="w-full mb-2 p-2 border rounded"
          />
        </div>
        <div>
          <label htmlFor="remark">備註</label>
          <input
            id="remark"
            type="text"
            value={remark}
            onChange={e => setRemark(e.target.value)}
            className="w-full mb-2 p-2 border rounded"
          />
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-300 rounded">取消</button>
          <button type="submit" className="px-4 py-2 bg-green-500 text-white rounded">新增</button>
        </div>
      </form>
    </div>
  );
};

// ========== EditMemberForm 元件 ==========
const EditMemberForm: React.FC<{ member: Member; onSuccess: () => void; onCancel: () => void }> = ({ member, onSuccess, onCancel }) => {
  const [name, setName] = useState(member.name);
  const [phone, setPhone] = useState(member.phone);
  const [join_date, setJoinDate] = useState(member.join_date);
  const [remark, setRemark] = useState(member.remark);
  const [grade, setGrade] = useState(member.grade);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.from('members').update({
      name, phone, join_date, remark, grade
    }).eq('id', member.id);
    if (error) {
      alert('更新失敗: ' + error.message);
    } else {
      onSuccess();
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50">
      <form className="bg-white p-6 rounded shadow-md w-96" onSubmit={handleSubmit}>
        <h2 className="text-lg font-bold mb-4">編輯會員</h2>
        <div>
          <label htmlFor="member_id">會員編號</label>
          <input
            id="member_id"
            type="text"
            value={member.member_id}
            disabled
            className="w-full mb-2 p-2 border rounded"
          />
        </div>
        <div>
          <label htmlFor="name">姓名</label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            required
            className="w-full mb-2 p-2 border rounded"
          />
        </div>
        <div>
          <label htmlFor="phone">電話</label>
          <input
            id="phone"
            type="text"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            className="w-full mb-2 p-2 border rounded"
          />
        </div>
        <div>
          <label htmlFor="join_date">加入日期</label>
          <input
            id="join_date"
            type="date"
            value={join_date}
            onChange={e => setJoinDate(e.target.value)}
            required
            className="w-full mb-2 p-2 border rounded"
          />
        </div>
        <div>
          <label htmlFor="grade">級數</label>
          <input
            id="grade"
            type="text"
            value={grade}
            onChange={e => setGrade(e.target.value)}
            className="w-full mb-2 p-2 border rounded"
          />
        </div>
        <div>
          <label htmlFor="remark">備註</label>
          <input
            id="remark"
            type="text"
            value={remark}
            onChange={e => setRemark(e.target.value)}
            className="w-full mb-2 p-2 border rounded"
          />
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-300 rounded">取消</button>
          <button type="submit" className="px-4 py-2 bg-blue-500 text-white rounded">儲存</button>
        </div>
      </form>
    </div>
  );
};

// ========== 主組件 ==========
const MemberManagement: React.FC<{ loginUser?: LoginUser | null }> = ({ loginUser }) => {
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState<LoginUser | null>(loginUser ?? null);

  // 只在元件 mount 時 fallback localStorage，避免無限 setState
  useEffect(() => {
    if (!currentUser) {
      const user = localStorage.getItem('loginUser');
      if (user) {
        const parsed = JSON.parse(user);
        if (parsed && parsed.team_id) {
          setCurrentUser(parsed);
        }
      }
    }
  }, []); // 只執行一次

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-gray-100 p-6 flex justify-center items-center">
        <div className="bg-white p-8 rounded-lg shadow-md">
          <h2 className="text-xl font-bold mb-4">需要登入</h2>
          <p>您需要登入後才能訪問會員管理系統。</p>
          <Link to="/" className="mt-4 inline-block px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
            返回主選單
          </Link>
        </div>
      </div>
    );
  }

  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);
  const [currentMember, setCurrentMember] = useState<Member | null>(null);

  const isAdmin = currentUser && (currentUser.role === 'admin' || currentUser.role === 'team_admin');

  // 直接使用 props 中的 currentLoggedInUser，移除從 localStorage 獲取數據的部分
  useEffect(() => {
    const fetchMembers = async () => {
      if (!currentUser || !currentUser.team_id) {
        setLoading(false);
        alert('登入者資訊異常，請確認帳號具有正確的團隊ID！');
        return;
      }
      setLoading(true);
      const { data, error } = await supabase
        .from('members')
        .select('*')
        .eq('team_id', currentUser.team_id); // 使用 currentLoggedInUser
      if (!error) {
        setMembers(data);
      } else {
        alert('會員資料載入失敗，請稍後再試！');
      }
      setLoading(false);
    };
    fetchMembers();
  }, [currentUser]);

  const handleDelete = async (id: string) => {
    if (!isAdmin) return;
    if (!window.confirm('確定要刪除此會員資料嗎？此操作無法撤銷。')) {
      return;
    }
    try {
      const { error } = await supabase.from('members').delete().eq('id', id);
      if (error) throw error;
      
      // 重新獲取會員列表
      const fetchMembers = async () => {
        if (!currentUser || !currentUser.team_id) return;
        setLoading(true);
        const { data, error } = await supabase
          .from('members')
          .select('*')
          .eq('team_id', currentUser.team_id); // 使用 currentLoggedInUser
        if (error) throw error;
        setMembers(data || []);
        setLoading(false);
      };
      fetchMembers();
    } catch (error) {
      console.error('刪除會員失敗:', error);
      alert('刪除會員失敗，請稍後再試！');
    }
  };

  const handleEdit = (member: Member) => {
    if (!isAdmin) return;
    setCurrentMember(member);
    setShowEditForm(true);
  };

  // 重新獲取會員列表的函數
  const refreshMembers = async () => {
    if (!currentUser || !currentUser.team_id) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('members')
      .select('*')
      .eq('team_id', currentUser.team_id);
    if (error) {
      console.error('獲取會員失敗:', error);
      alert('獲取會員失敗，請稍後再試！');
    } else {
      setMembers(data || []);
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div className="w-full max-w-full sm:max-w-6xl mx-auto">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-2">
          <h1 className="text-2xl font-bold">會員管理系統</h1>
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 w-full sm:w-auto">
            <span className="mr-0 sm:mr-4">當前用戶: {currentUser.name} | 團隊ID: {currentUser.team_id}</span>
            <Link to="/" className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 w-full sm:w-auto text-center">
              返回主選單
            </Link>
          </div>
        </div>

        {isAdmin && (
          <div className="flex flex-wrap gap-2 mb-4">
            <button
              onClick={() => setShowAddForm(true)}
              className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 w-full sm:w-auto"
            >
              新增會員
            </button>
            <Link to="/contest-control" className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 w-full sm:w-auto text-center">
              賽程控制區
            </Link>
          </div>
        )}

        {loading ? (
          <div className="text-center py-8">載入中...</div>
        ) : (
          <div className="bg-white shadow-md rounded-lg overflow-x-auto overflow-y-auto w-full max-h-[60vh]">
            <table className="min-w-[600px] divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="sm:px-6 px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">會員編號</th>
                  <th className="sm:px-6 px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">姓名</th>
                  <th className="sm:px-6 px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">電話</th>
                  <th className="sm:px-6 px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">加入日期</th>
                  <th className="sm:px-6 px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">級數</th>
                  <th className="sm:px-6 px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">備註</th>
                  <th className="sm:px-6 px-2 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {members.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="sm:px-6 px-2 py-4 text-center text-gray-500">
                      沒有找到會員資料
                    </td>
                  </tr>
                ) : (
                  members.map((member) => (
                    <tr key={member.id}>
                      <td className="sm:px-6 px-2 py-4 whitespace-nowrap">{member.member_id}</td>
                      <td className="sm:px-6 px-2 py-4 whitespace-nowrap">{member.name}</td>
                      <td className="sm:px-6 px-2 py-4 whitespace-nowrap">{member.phone || '-'}</td>
                      <td className="sm:px-6 px-2 py-4 whitespace-nowrap">{member.join_date}</td>
                      <td className="sm:px-6 px-2 py-4 whitespace-nowrap">{member.grade || '-'}</td>
                      <td className="sm:px-6 px-2 py-4">{member.remark || '-'}</td>
                      <td className="sm:px-6 px-2 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <button
                          onClick={() => isAdmin && handleEdit(member)}
                          className={`mr-3 px-2 py-1 rounded ${
                            isAdmin
                              ? "text-indigo-600 hover:text-indigo-900"
                              : "text-gray-400 cursor-not-allowed bg-gray-100"
                          }`}
                          disabled={!isAdmin}
                          title={isAdmin ? "編輯" : "只有管理員可以編輯"}
                        >
                          編輯
                        </button>
                        <button
                          onClick={() => isAdmin && handleDelete(member.id)}
                          className={`px-2 py-1 rounded ${
                            isAdmin
                              ? "text-red-600 hover:text-red-900"
                              : "text-gray-300 cursor-not-allowed bg-gray-100"
                          }`}
                          disabled={!isAdmin}
                          title={isAdmin ? "刪除" : "只有管理員可以刪除"}
                        >
                          刪除
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 新增會員表單 */}
      {showAddForm && (
        <AddMemberForm
          onSuccess={() => {
            setShowAddForm(false);
            refreshMembers();
          }}
          onCancel={() => setShowAddForm(false)}
          loginUser={currentUser}
        />
      )}

      {/* 編輯會員表單 */}
      {showEditForm && currentMember && (
        <EditMemberForm
          member={currentMember}
          onSuccess={() => {
            setShowEditForm(false);
            refreshMembers();
          }}
          onCancel={() => setShowEditForm(false)}
        />
      )}
    </div>
  );
};

export default MemberManagement;