import React, { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';

const CourtIntroPage: React.FC = () => {
  const [courts, setCourts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [teamName, setTeamName] = useState<string | null>(null);

  useEffect(() => {
    const fetchUserAndCourts = async () => {
      setLoading(true);
      setError(null);
      
      try {
        // 從 localStorage 獲取登入用戶資訊
        const loginUserStr = localStorage.getItem('loginUser');
        
        if (!loginUserStr) {
          setError('請先登入系統');
          setLoading(false);
          return;
        }
        
        const loginUser = JSON.parse(loginUserStr);
        
        if (!loginUser.team_id) {
          setError('無法獲取您的團隊資訊，請聯絡管理員');
          setLoading(false);
          return;
        }
        
        setCurrentUser(loginUser);
        
        // 根據用戶的 team_id 獲取球場資料
        const { data, error } = await supabase
          .from('courts')
          .select('*')
          .eq('team_id', loginUser.team_id)
          .order('name');
          
        if (error) {
          setError('取得球場資料失敗: ' + error.message);
        } else {
          setCourts(data || []);
          // 從第一筆資料中獲取團隊名稱
          if (data && data.length > 0) {
            setTeamName(data[0].name);
          }
        }
        
      } catch (err) {
        setError('系統錯誤，請稍後再試');
        console.error('Error:', err);
      }
      
      setLoading(false);
    };
    
    fetchUserAndCourts();
  }, []);

  // 如果用戶未登入，顯示登入提示
  if (!loading && !currentUser) {
    return (
      <div className="max-w-7xl mx-auto p-4 sm:p-6">
        <div className="text-center py-12">
          <div className="text-6xl mb-4">🔒</div>
          <h2 className="text-2xl font-bold text-gray-800 mb-4">需要登入</h2>
          <p className="text-gray-600 mb-6">請先登入系統以查看球場資訊</p>
          <button 
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            onClick={() => window.location.reload()}
          >
            重新載入頁面
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-3xl font-bold text-gray-800">團隊資訊</h2>
        {currentUser && (
          <div className="flex items-center space-x-3">
            <span className="text-sm text-gray-600">
              歡迎，{currentUser.name}
            </span>
            <span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm">
              團隊: {teamName || currentUser.team_id}
            </span>
          </div>
        )}
      </div>
      
      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-6">
          {error}
        </div>
      )}
      
      {loading ? (
        <div className="flex justify-center items-center py-12">
          <div className="flex items-center space-x-2">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
            <div className="text-lg text-gray-600">載入中...</div>
          </div>
        </div>
      ) : courts.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-6xl mb-4">🏓</div>
          <h3 className="text-xl text-gray-600 mb-2">管理員尚未輸入團隊資訊</h3>
          <p className="text-gray-500">
            團隊 {teamName || currentUser?.team_id} 尚未新增任何資訊
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {courts.map((court, idx) => (
            <div key={idx} className="bg-white rounded-lg shadow-lg hover:shadow-xl transition-shadow duration-300 overflow-hidden">
              {/* 球場照片 */}
              <div className="relative h-48 bg-gray-200">
                {court.photo_url ? (
                  <img
                    src={court.photo_url}
                    alt={court.name}
                    className="w-full h-full object-cover cursor-pointer hover:scale-105 transition-transform duration-300"
                    onClick={() => setPreviewUrl(court.photo_url)}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-500">
                    <div className="text-center">
                      <div className="text-4xl mb-2">🏓</div>
                      <div>暫無照片</div>
                    </div>
                  </div>
                )}
              </div>
              
              {/* 球場資訊 */}
              <div className="p-5">
                <div className="flex justify-between items-start mb-3">
                  <h3 className="text-xl font-bold text-gray-800">{court.name}</h3>
                  <span className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full">
                    {court.team_id}
                  </span>
                </div>
                
                {/* 球場介紹 */}
                {court.description && (
                  <div className="mb-4">
                    <h4 className="text-sm font-semibold text-gray-600 mb-1">球場介紹</h4>
                    <p className="text-sm text-gray-700 whitespace-pre-line leading-relaxed">
                      {court.description}
                    </p>
                  </div>
                )}
                
                {/* 收費政策 */}
                {court.fee && (
                  <div className="mb-4">
                    <h4 className="text-sm font-semibold text-gray-600 mb-1">收費政策</h4>
                    <p className="text-sm text-green-700 whitespace-pre-line">
                      {court.fee}
                    </p>
                  </div>
                )}
                
                {/* 地點 */}
                {court.location && (
                  <div className="mb-4">
                    <h4 className="text-sm font-semibold text-gray-600 mb-1">📍 地點</h4>
                    <p className="text-sm text-gray-700 whitespace-pre-line">
                      {court.location}
                    </p>
                  </div>
                )}
                
                {/* 聯絡資訊 */}
                <div className="border-t pt-4 mt-4">
                  <h4 className="text-sm font-semibold text-gray-600 mb-2">聯絡資訊</h4>
                  <div className="space-y-1">
                    {court.contact_person && (
                      <div className="flex items-center text-sm text-gray-700">
                        <span className="w-4 h-4 mr-2">👤</span>
                        {court.contact_person}
                      </div>
                    )}
                    {court.contact_info && (
                      <div className="flex items-center text-sm text-gray-700">
                        <span className="w-4 h-4 mr-2">📞</span>
                        {court.contact_info}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      
      {/* 圖片預覽模態框 */}
      {previewUrl && (
        <div
          className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4"
          onClick={() => setPreviewUrl(null)}
        >
          <div
            className="bg-white rounded-lg shadow-2xl p-4 max-w-full max-h-full flex flex-col items-center"
            onClick={(e) => e.stopPropagation()}
          >
            <img 
              src={previewUrl} 
              alt="預覽大圖" 
              className="max-h-[80vh] max-w-[90vw] rounded-lg mb-4 object-contain" 
            />
            <button
              className="px-6 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-800 transition-colors"
              onClick={() => setPreviewUrl(null)}
            >
              關閉
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default CourtIntroPage;