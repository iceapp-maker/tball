import React, { useEffect, useState, useContext, ChangeEvent } from 'react';
import { supabase } from './supabaseClient';
import { UserContext } from './UserContext';
import { useNavigate } from 'react-router-dom';

const CourtManagement: React.FC = () => {
  const { user } = useContext(UserContext) ?? { user: null };
  const [court, setCourt] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const isAdmin = user?.role === 'admin';
  const teamId = user?.team_id;
  const navigate = useNavigate();

  useEffect(() => {
    // log supabase auth user id for debug
    (async () => {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      console.log('supabase.auth.user id:', authUser?.id);
    })();
    const fetchCourt = async () => {
      setLoading(true);
      setError(null);
      const { data, error } = await supabase
        .from('courts')
        .select('*')
        .eq('team_id', teamId)
        .maybeSingle();
      if (error) setError('取得球場資料失敗: ' + error.message);
      else setCourt(data);
      setLoading(false);
    };
    if (teamId) fetchCourt();
  }, [teamId]);

  const handleChange = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setCourt((prev: any) => ({ ...prev, [name]: value }));
  };

  const handlePhotoChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setPhotoFile(e.target.files[0]);
      setPhotoPreview(URL.createObjectURL(e.target.files[0]));
    }
  };

  const handleSave = async () => {
    setSaving(true);
    let photo_url = court.photo_url;
    console.log('teamId:', teamId);
    if (photoFile) {
      // 上傳圖片到 Supabase Storage
      const fileExt = photoFile.name.split('.').pop();
      const filePath = `courts/${teamId}_${Date.now()}.${fileExt}`;
      const { error: uploadError } = await supabase.storage.from('court-photos').upload(filePath, photoFile, { upsert: true });
      if (uploadError) {
        console.log('uploadError:', uploadError);
        setError('圖片上傳失敗: ' + uploadError.message);
        setSaving(false);
        return;
      }
      // 修正 getPublicUrl 取得方式
      const { data } = supabase.storage.from('court-photos').getPublicUrl(filePath);
      photo_url = data.publicUrl;
      console.log('photo_url:', photo_url);
    }
    // 更新 courts 資料
    const { error: updateError } = await supabase
      .from('courts')
      .update({
        name: court.name,
        photo_url,
        description: court.description,
        fee: court.fee,
        remarks: court.remarks,
        contact_person: court.contact_person,
        contact_info: court.contact_info,
        location: court.location,
      })
      .eq('team_id', teamId);
    console.log('updateError:', updateError);
    if (updateError) setError('儲存失敗: ' + updateError.message);
    else {
      setError(null);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000); // 2秒後自動消失
    }
    setSaving(false);
    setPhotoFile(null);
    setPhotoPreview(null);
    // 重新抓取最新資料
    const { data } = await supabase
      .from('courts')
      .select('*')
      .eq('team_id', teamId)
      .maybeSingle();
    if (data) setCourt(data);
  };

  if (loading) return <div className="p-8">載入中...</div>;
  if (error) return <div className="p-8 text-red-600">錯誤：{error}</div>;
  if (!court) return <div className="p-8">查無球場資料</div>;

  return (
    <div className="max-w-xl mx-auto mt-10 p-6 bg-white rounded shadow">
      {success && (
        <div className="text-green-600 mb-2">儲存成功！</div>
      )}
      <button
        className="mb-4 px-4 py-2 bg-gray-200 rounded hover:bg-gray-300"
        onClick={() => navigate(-1)}
      >
        ← 回上頁
      </button>
      <h2 className="text-2xl font-bold mb-4">球場資料輸入</h2>
      <div className="mb-4">
        <label className="block font-medium mb-1">場地名稱</label>
        <input
          type="text"
          name="name"
          value={court?.name || ''}
          onChange={handleChange}
          className="w-full p-2 border rounded"
          disabled={!isAdmin}
        />
      </div>
      <div className="mb-4">
        <label className="block font-medium mb-1">場地照片</label>
        {court?.photo_url && !photoPreview && (
          <img src={court.photo_url} alt="場地照片" className="mb-2 max-h-40 rounded" />
        )}
        {photoPreview && (
          <img src={photoPreview} alt="預覽" className="mb-2 max-h-40 rounded" />
        )}
        {isAdmin && (
          <input type="file" accept="image/*" onChange={handlePhotoChange} />
        )}
      </div>
      <div className="mb-4">
        <label className="block font-medium mb-1">球場介紹</label>
        <textarea
          name="description"
          value={court?.description || ''}
          onChange={handleChange}
          className="w-full p-2 border rounded"
          rows={3}
          disabled={!isAdmin}
        />
      </div>
      <div className="mb-4">
        <label className="block font-medium mb-1">收費政策</label>
        <input
          type="text"
          name="fee"
          value={court?.fee || ''}
          onChange={handleChange}
          className="w-full p-2 border rounded"
          disabled={!isAdmin}
        />
      </div>
      <div className="mb-4">
        <label className="block font-medium mb-1">備註</label>
        <textarea
          name="remarks"
          value={court?.remarks || ''}
          onChange={handleChange}
          className="w-full p-2 border rounded"
          rows={2}
          disabled={!isAdmin}
        />
      </div>
      <div className="mb-4">
        <label className="block font-medium mb-1">球場聯絡人</label>
        <input
          type="text"
          name="contact_person"
          value={court?.contact_person || ''}
          onChange={handleChange}
          className="w-full p-2 border rounded"
          disabled={!isAdmin}
        />
      </div>
      <div className="mb-4">
        <label className="block font-medium mb-1">聯絡方式</label>
        <input
          type="text"
          name="contact_info"
          value={court?.contact_info || ''}
          onChange={handleChange}
          className="w-full p-2 border rounded"
          disabled={!isAdmin}
        />
      </div>
      <div className="mb-4">
        <label className="block font-medium mb-1">地點</label>
        <input
          type="text"
          name="location"
          value={court?.location || ''}
          onChange={handleChange}
          className="w-full p-2 border rounded"
          disabled={!isAdmin}
        />
      </div>
      {isAdmin && (
        <button
          className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? '儲存中...' : '儲存'}
        </button>
      )}
    </div>
  );
};

export default CourtManagement;
