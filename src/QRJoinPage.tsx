import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from './supabaseClient';
import { Modal, Button, Spin } from 'antd';

interface InviteData {
  contest_id: string;
  team_id: string;
  member_id: string;
  timestamp: string;
}

const QRJoinPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [inviteData, setInviteData] = useState<InviteData | null>(null);
  const [contestInfo, setContestInfo] = useState<any>(null);
  const [teamInfo, setTeamInfo] = useState<any>(null);
  const [memberInfo, setMemberInfo] = useState<any>(null);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    const processQRCode = async () => {
      try {
        // 從URL參數中獲取邀請數據
        const params = new URLSearchParams(location.search);
        const encodedData = params.get('data');
        
        if (!encodedData) {
          setError('無效的邀請連結');
          setLoading(false);
          return;
        }

        // 解碼邀請數據
        let decodedData: InviteData;
        try {
          const jsonString = atob(encodedData);
          decodedData = JSON.parse(jsonString);
          console.log('解碼的邀請數據:', decodedData);
        } catch (decodeError) {
          console.error('解碼失敗:', decodeError);
          setError('邀請連結格式錯誤');
          setLoading(false);
          return;
        }

        setInviteData(decodedData);

        // 檢查邀請是否過期（可選，例如24小時內有效）
        const inviteTime = new Date(decodedData.timestamp);
        const now = new Date();
        const hoursDiff = (now.getTime() - inviteTime.getTime()) / (1000 * 60 * 60);
        
        if (hoursDiff > 24) {
          setError('邀請連結已過期（超過24小時）');
          setLoading(false);
          return;
        }

        // 獲取比賽資訊
        const { data: contest, error: contestError } = await supabase
          .from('contest')
          .select('contest_id, contest_name, contest_status')
          .eq('contest_id', decodedData.contest_id)
          .single();

        if (contestError || !contest) {
          setError('找不到相關比賽資訊');
          setLoading(false);
          return;
        }

        setContestInfo(contest);

        // 獲取隊伍資訊
        const { data: team, error: teamError } = await supabase
          .from('contest_team')
          .select('contest_team_id, team_name, created_by')
          .eq('contest_team_id', decodedData.team_id)
          .single();

        if (teamError || !team) {
          setError('找不到相關隊伍資訊');
          setLoading(false);
          return;
        }

        setTeamInfo(team);

        // 獲取被邀請成員資訊
        const { data: member, error: memberError } = await supabase
          .from('members')
          .select('member_id, name, team_id')
          .eq('member_id', decodedData.member_id)
          .single();

        if (memberError || !member) {
          setError('找不到相關成員資訊');
          setLoading(false);
          return;
        }

        setMemberInfo(member);

        // 檢查是否已經在隊伍中
        const { data: existingMember, error: existingError } = await supabase
          .from('contest_team_member')
          .select('status')
          .eq('contest_team_id', decodedData.team_id)
          .eq('member_id', decodedData.member_id)
          .single();

        if (existingMember) {
          if (existingMember.status === 'accepted' || existingMember.status === 'captain') {
            setError('您已經是該隊伍的成員了');
            setLoading(false);
            return;
          }
        }

        setLoading(false);
      } catch (err) {
        console.error('處理QR碼時發生錯誤:', err);
        setError('處理邀請時發生錯誤');
        setLoading(false);
      }
    };

    processQRCode();
  }, [location.search]);

  const handleAcceptInvite = async () => {
    if (!inviteData || !memberInfo) return;

    setProcessing(true);
    try {
      // 檢查是否已經有邀請記錄
      const { data: existingInvite, error: checkError } = await supabase
        .from('contest_team_member')
        .select('*')
        .eq('contest_team_id', inviteData.team_id)
        .eq('member_id', inviteData.member_id)
        .single();

      if (existingInvite) {
        // 更新現有記錄為已接受
        const { error: updateError } = await supabase
          .from('contest_team_member')
          .update({ 
            status: 'accepted',
            responded_at: new Date().toISOString()
          })
          .eq('contest_team_id', inviteData.team_id)
          .eq('member_id', inviteData.member_id);

        if (updateError) {
          throw updateError;
        }
      } else {
        // 創建新的成員記錄
        const { error: insertError } = await supabase
          .from('contest_team_member')
          .insert({
            contest_team_id: inviteData.team_id,
            contest_id: parseInt(inviteData.contest_id),
            member_id: inviteData.member_id,
            member_name: memberInfo.name,
            status: 'accepted',
            responded_at: new Date().toISOString()
          });

        if (insertError) {
          throw insertError;
        }
      }

      // 將被邀請成員的資訊存入 localStorage，實現臨時登入
      const tempUser = {
        member_id: inviteData.member_id,
        name: memberInfo.name,
        team_id: memberInfo.team_id,
        role: 'member', // 預設為一般成員
        is_captain: false
      };
      localStorage.setItem('loginUser', JSON.stringify(tempUser));
      
      Modal.success({
        title: '加入成功！',
        content: `您已成功加入 ${teamInfo?.team_name} 隊伍參加 ${contestInfo?.contest_name}`,
        onOk: () => {
          // 跳轉到比賽頁面
          navigate(`/contest/${inviteData.contest_id}/join`);
        }
      });

    } catch (err: any) {
      console.error('接受邀請失敗:', err);
      Modal.error({
        title: '加入失敗',
        content: '加入隊伍時發生錯誤: ' + (err.message || '未知錯誤')
      });
    } finally {
      setProcessing(false);
    }
  };

  const handleRejectInvite = () => {
    Modal.confirm({
      title: '確認拒絕邀請',
      content: '您確定要拒絕加入這個隊伍嗎？',
      okText: '確認拒絕',
      cancelText: '取消',
      onOk: async () => {
        if (!inviteData) return;

        try {
          // 檢查是否已經有邀請記錄
          const { data: existingInvite } = await supabase
            .from('contest_team_member')
            .select('*')
            .eq('contest_team_id', inviteData.team_id)
            .eq('member_id', inviteData.member_id)
            .single();

          if (existingInvite) {
            // 更新現有記錄為已拒絕
            await supabase
              .from('contest_team_member')
              .update({ 
                status: 'rejected',
                responded_at: new Date().toISOString()
              })
              .eq('contest_team_id', inviteData.team_id)
              .eq('member_id', inviteData.member_id);
          }

          Modal.info({
            title: '已拒絕邀請',
            content: '您已拒絕加入該隊伍',
            onOk: () => {
              navigate('/contests');
            }
          });
        } catch (err) {
          console.error('拒絕邀請失敗:', err);
          Modal.error({
            title: '操作失敗',
            content: '拒絕邀請時發生錯誤'
          });
        }
      }
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="bg-white p-8 rounded-lg shadow-md text-center">
          <Spin size="large" />
          <p className="mt-4">正在處理邀請...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="bg-white p-8 rounded-lg shadow-md text-center max-w-md">
          <h2 className="text-xl font-bold mb-4 text-red-600">邀請無效</h2>
          <p className="mb-6 text-gray-700">{error}</p>
          <div className="space-y-3">
            <Button 
              type="primary" 
              onClick={() => navigate('/contests')}
              block
            >
              前往參賽區
            </Button>
            <Button 
              onClick={() => navigate('/')}
              block
            >
              返回首頁
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center">
      <div className="bg-white p-8 rounded-lg shadow-md max-w-md w-full mx-4">
        <h2 className="text-2xl font-bold mb-6 text-center text-blue-600">隊伍邀請</h2>
        
        <div className="space-y-4 mb-8">
          <div className="bg-blue-50 p-4 rounded-lg">
            <h3 className="font-semibold text-blue-800 mb-2">比賽資訊</h3>
            <p className="text-blue-700">{contestInfo?.contest_name}</p>
          </div>
          
          <div className="bg-green-50 p-4 rounded-lg">
            <h3 className="font-semibold text-green-800 mb-2">隊伍資訊</h3>
            <p className="text-green-700">隊伍名稱：{teamInfo?.team_name}</p>
            <p className="text-green-700">隊長：{teamInfo?.created_by}</p>
          </div>
          
          <div className="bg-purple-50 p-4 rounded-lg">
            <h3 className="font-semibold text-purple-800 mb-2">邀請對象</h3>
            <p className="text-purple-700">{memberInfo?.name}</p>
          </div>
        </div>

        <div className="text-center mb-6">
          <p className="text-gray-600 mb-2">您被邀請加入上述隊伍參加比賽</p>
          <p className="text-sm text-gray-500">請選擇您的回應：</p>
        </div>

        <div className="space-y-3">
          <Button
            type="primary"
            size="large"
            onClick={handleAcceptInvite}
            loading={processing}
            block
            className="bg-green-500 hover:bg-green-600 border-green-500"
          >
            接受邀請
          </Button>
          
          <Button
            size="large"
            onClick={handleRejectInvite}
            disabled={processing}
            block
            danger
          >
            拒絕邀請
          </Button>
          
          <Button
            size="large"
            onClick={() => navigate('/contests')}
            disabled={processing}
            block
          >
            稍後決定
          </Button>
        </div>
      </div>
    </div>
  );
};

export default QRJoinPage;