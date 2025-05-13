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
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleLogin = async () => {
    const { data, error: rpcError } = await supabase.rpc('login_member', {
      p_member_id: memberId,
      p_password: password
    });
    if (rpcError) {
      setError('登入失敗，請稍後再試');
      return;
    }
    if (data && data.length > 0) {
      setCurrentLoggedInUser(data[0]);
      localStorage.setItem('loginUser', JSON.stringify(data[0])); // 同步寫入 localStorage
      onClose();
      // 立即重新整理首頁
      window.location.reload();
    } else {
      setError('帳號或密碼錯誤');
    }
  };

  const handleLoginSuccess = (userData) => {
    // 設置 React 狀態
    setCurrentLoggedInUser(userData);
    
    // 同時存儲到 localStorage
    localStorage.setItem('loginUser', JSON.stringify(userData));
    
    onClose();
};

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-30 z-50">
      <div className="bg-white p-8 rounded-lg shadow-lg w-80">
        <h2 className="text-xl font-bold mb-4">會員登入</h2>
        <input
          className="w-full mb-3 p-2 border rounded"
          placeholder="member_id"
          value={memberId}
          onChange={e => setMemberId(e.target.value)}
        />
        <input
          className="w-full mb-3 p-2 border rounded"
          type="password"
          placeholder="密碼"
          value={password}
          onChange={e => setPassword(e.target.value)}
        />
        {error && <div className="text-red-600 mb-2">{error}</div>}
        <div className="flex justify-between">
          <button
            className="px-4 py-2 bg-blue-600 text-white rounded"
            onClick={handleLogin}
          >
            登入
          </button>
          <button
            className="px-4 py-2 bg-gray-400 text-white rounded"
            onClick={onClose}
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}