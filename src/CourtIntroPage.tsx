import React, { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';

const CourtIntroPage: React.FC = () => {
  const [courts, setCourts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    const fetchCourts = async () => {
      setLoading(true);
      setError(null);
      const { data, error } = await supabase.from('courts').select('*');
      if (error) setError('取得球場資料失敗: ' + error.message);
      else setCourts(data || []);
      setLoading(false);
    };
    fetchCourts();
  }, []);

  return (
    <div className="max-w-3xl mx-auto p-2 sm:p-6 overflow-x-auto">
      <h2 className="text-2xl font-bold mb-4">球場介紹</h2>
      {error && <div className="text-red-500 mb-2">{error}</div>}
      {loading ? (
        <div>載入中...</div>
      ) : (
        <table className="min-w-[700px] border border-gray-300 rounded text-xs sm:text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="p-1 sm:p-2 border">球場代號</th>
              <th className="p-1 sm:p-2 border">球場名稱</th>
              <th className="p-1 sm:p-2 border">照片</th>
              <th className="p-1 sm:p-2 border">球場介紹</th>
              <th className="p-1 sm:p-2 border">收費政策</th>
              <th className="p-1 sm:p-2 border">球場聯絡人</th>
              <th className="p-1 sm:p-2 border">聯絡方式</th>
              <th className="p-1 sm:p-2 border">地點</th>
            </tr>
          </thead>
          <tbody>
            {courts.map((court, idx) => (
              <tr key={idx}>
                <td className="p-1 sm:p-2 border">{court.team_id}</td>
                <td className="p-1 sm:p-2 border">{court.name}</td>
                <td className="p-1 sm:p-2 border text-center">
                  {court.photo_url ? (
                    <img
                      src={court.photo_url}
                      alt={court.name}
                      className="mx-auto max-w-[48px] max-h-[48px] object-contain cursor-pointer hover:scale-110 transition-transform"
                      onClick={() => setPreviewUrl(court.photo_url)}
                    />
                  ) : '無'}
                </td>
                <td className="p-1 sm:p-2 border whitespace-pre-line">{court.description}</td>
                <td className="p-1 sm:p-2 border whitespace-pre-line">{court.fee}</td>
                <td className="p-1 sm:p-2 border">{court.contact_person}</td>
                <td className="p-1 sm:p-2 border">{court.contact_info}</td>
                <td className="p-1 sm:p-2 border whitespace-pre-line">{court.location}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Modal for preview */}
      {previewUrl && (
        <div
          className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50"
          onClick={() => setPreviewUrl(null)}
        >
          <div
            className="bg-white rounded shadow-lg p-4 max-w-full max-h-full flex flex-col items-center"
            onClick={(e) => e.stopPropagation()}
          >
            <img src={previewUrl} alt="預覽大圖" className="max-h-[70vh] max-w-[90vw] rounded mb-4" />
            <button
              className="px-4 py-2 bg-gray-700 text-white rounded hover:bg-gray-900"
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
