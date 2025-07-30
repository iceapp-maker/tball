import React, { useState } from 'react';
import { supabase } from './supabaseClient';
import { useNavigate } from 'react-router-dom';

interface LoginModalProps {
  setCurrentLoggedInUser: (user: any) => void;
  onClose: () => void;
}

export default function LoginModal({ setCurrentLoggedInUser, onClose }: LoginModalProps) {
  const [memberId, setMemberId] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isFirstLogin, setIsFirstLogin] = useState(false);
  const [memberData, setMemberData] = useState<any>(null);
  const navigate = useNavigate();

  // 驗證會員身份並檢查狀態
  const checkMemberStatus = async () => {
    if (!memberId.trim()) {
      setError('請輸入會員編號');
      return;
    }
    
    try {
      setError('');
      // 使用不區分大小寫的查詢，直接用會員編號查詢
      const { data, error } = await supabase
        .from('members')
        .select('id, member_id, name, password_hash, must_change_password, role, team_id')
        .ilike('member_id', memberId.trim()) // 使用 ilike 進行不區分大小寫的匹配
        .single();
        
      if (error || !data) {
        setError('會員編號錯誤');
        return;
      }
      
      setMemberData(data);
      if (data.password_hash === null) {
        setIsFirstLogin(true);
        setError('');
      } else {
        setIsFirstLogin(false);
        setError('');
      }
    } catch (error) {
      setError('系統錯誤，請稍後再試');
    }
  };

  // 一般登入
  const handleLogin = async () => {
    if (!password.trim()) {
      setError('請輸入密碼');
      return;
    }

    try {
      // 直接查詢並驗證密碼
      const { data, error } = await supabase.rpc('verify_member_password', {
        p_member_id: memberData.member_id,
        p_password: password
      });

      if (error) {
        console.error('RPC 錯誤:', error);
        setError('登入失敗，請稍後再試');
        return;
      }

      if (data && data.length > 0) {
        setCurrentLoggedInUser(data[0]);
        localStorage.setItem('loginUser', JSON.stringify(data[0]));
        onClose();
        window.location.reload();
      } else {
        setError('密碼錯誤');
      }
    } catch (error) {
      console.error('登入錯誤:', error);
      setError('系統錯誤，請稍後再試');
    }
  };

  // 首次登入設定密碼
  const handleSetPassword = async () => {
    // 驗證密碼
    if (!newPassword.trim()) {
      setError('請輸入新密碼');
      return;
    }
    
    if (newPassword.length < 6) {
      setError('密碼長度至少需要6個字元');
      return;
    }
    
    if (newPassword !== confirmPassword) {
      setError('兩次密碼輸入不一致');
      return;
    }

    try {
      // 更新密碼
      const { error } = await supabase
        .from('members')
        .update({ 
          password_hash: newPassword, // 觸發函數會自動加密
          must_change_password: false 
        })
        .eq('id', memberData.id);

      if (error) {
        setError('設定密碼失敗，請稍後再試');
        return;
      }

      // 設定密碼成功後，使用新密碼登入
      const updatedMemberData = {
        ...memberData,
        must_change_password: false
      };
      
      setCurrentLoggedInUser(updatedMemberData);
      localStorage.setItem('loginUser', JSON.stringify(updatedMemberData));
      onClose();
      window.location.reload();
    } catch (error) {
      setError('系統錯誤，請稍後再試');
    }
  };

  // 重置狀態
  const resetToInput = () => {
    setIsFirstLogin(false);
    setMemberData(null);
    setPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setError('');
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-30 z-50">
      <div className="bg-white p-8 rounded-lg shadow-lg w-80">
         {!memberData ? (
          // 步驟1：輸入會員編號
          <>
            <h2 className="text-xl font-bold mb-4">登入</h2>
            <input
              className="w-full mb-3 p-2 border rounded"
              placeholder="請輸入會員編號（不區分大小寫）"
              value={memberId}
              onChange={e => setMemberId(e.target.value)}
              onKeyPress={e => e.key === 'Enter' && checkMemberStatus()}
              autoFocus
            />
            {error && <div className="text-red-600 mb-2 text-sm">{error}</div>}
            <div className="flex justify-between">
              <button
                className={
                  `px-4 py-2 rounded text-white ` +
                  (memberId.trim()
                    ? 'bg-blue-600 hover:bg-blue-700'
                    : 'bg-gray-400 cursor-not-allowed')
                }
                onClick={checkMemberStatus}
                disabled={!memberId.trim()}
              >
                繼續
              </button>
              <button
                className="px-4 py-2 bg-gray-400 text-white rounded hover:bg-gray-500"
                onClick={onClose}
              >
                取消
              </button>
            </div>
          </>
        ) : isFirstLogin ? (
          // 步驟2a：首次登入設定密碼
          <>
            <h2 className="text-xl font-bold mb-4">首次登入設定密碼</h2>
            <div className="mb-3 p-2 bg-blue-50 border border-blue-200 rounded">
              <div className="text-sm text-blue-800">歡迎 {memberData.name}</div>
              <div className="text-xs text-blue-600">會員編號：{memberData.member_id}</div>
            </div>
            <input
              className="w-full mb-3 p-2 border rounded"
              type="password"
              placeholder="請設定新密碼（至少6個字元）"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
            />
            <input
              className="w-full mb-3 p-2 border rounded"
              type="password"
              placeholder="請再次輸入新密碼"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              onKeyPress={e => e.key === 'Enter' && handleSetPassword()}
            />
            {error && <div className="text-red-600 mb-2 text-sm">{error}</div>}
            <div className="flex justify-between">
              <button
                className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
                onClick={handleSetPassword}
              >
                設定密碼
              </button>
              <button
                className="px-4 py-2 bg-gray-400 text-white rounded hover:bg-gray-500"
                onClick={resetToInput}
              >
                重新輸入
              </button>
            </div>
          </>
        ) : (
          // 步驟2b：一般登入
          <>
            <h2 className="text-xl font-bold mb-4">輸入密碼</h2>
            <div className="mb-3 p-2 bg-gray-50 border border-gray-200 rounded">
              <div className="text-sm text-gray-800">{memberData.name}</div>
              <div className="text-xs text-gray-600">會員編號：{memberData.member_id}</div>
            </div>
            <input
              className="w-full mb-3 p-2 border rounded"
              type="password"
              placeholder="請輸入密碼"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyPress={e => e.key === 'Enter' && handleLogin()}
              autoFocus
            />
            {error && <div className="text-red-600 mb-2 text-sm">{error}</div>}
            <div className="flex justify-between">
              <button
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                onClick={handleLogin}
              >
                登入
              </button>
              <button
                className="px-4 py-2 bg-gray-400 text-white rounded hover:bg-gray-500"
                onClick={resetToInput}
              >
                重新輸入
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}