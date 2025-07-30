/// <reference types="react" />
/// <reference types="react-router-dom" />
/// <reference types="antd" />

import React, { useEffect, useState, ChangeEvent } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { Modal, Button } from 'antd';

interface Contest {
  contest_id: number;
  contest_name: string;
  players_per_team: number;
  expected_teams: number;
}

interface Member {
  id: string;
  member_id: string;
  name: string;
  team_id: string;
}

interface TeamMemberStatus {
  member_name: string;
  member_id: string;
  status: string;
}

interface TeamMember {
  contest_team_id: string;
  member_id: string;
  member_name: string;
  status: string;
  contest_id: number;
}

interface Team {
  contest_team_id: string;
  team_name: string;
  created_by: string;
  contest_id: number;
  team_id?: string;
  contest_name?: string;
  team_member_status?: string;
}

interface SelectedMatch {
  contest_name: string;
  team_name: string;
  created_by: string;
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      div: React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement>;
      span: React.DetailedHTMLProps<React.HTMLAttributes<HTMLSpanElement>, HTMLSpanElement>;
      button: React.DetailedHTMLProps<React.ButtonHTMLAttributes<HTMLButtonElement>, HTMLButtonElement>;
      input: React.DetailedHTMLProps<React.InputHTMLAttributes<HTMLInputElement>, HTMLInputElement>;
      select: React.DetailedHTMLProps<React.SelectHTMLAttributes<HTMLSelectElement>, HTMLSelectElement>;
      option: React.DetailedHTMLProps<React.OptionHTMLAttributes<HTMLOptionElement>, HTMLOptionElement>;
      ul: React.DetailedHTMLProps<React.HTMLAttributes<HTMLUListElement>, HTMLUListElement>;
      li: React.DetailedHTMLProps<React.LiHTMLAttributes<HTMLLIElement>, HTMLLIElement>;
      b: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
      br: React.DetailedHTMLProps<React.HTMLAttributes<HTMLBRElement>, HTMLBRElement>;
      hr: React.DetailedHTMLProps<React.HTMLAttributes<HTMLHRElement>, HTMLHRElement>;
      h2: React.DetailedHTMLProps<React.HTMLAttributes<HTMLHeadingElement>, HTMLHeadingElement>;
      h3: React.DetailedHTMLProps<React.HTMLAttributes<HTMLHeadingElement>, HTMLHeadingElement>;
      p: React.DetailedHTMLProps<React.HTMLAttributes<HTMLParagraphElement>, HTMLParagraphElement>;
    }
  }
}

const ContestJoinPage: React.FC = () => {
  const { contest_id } = useParams<{ contest_id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [contest, setContest] = useState<Contest | null>(null);
  const [teamName, setTeamName] = useState('');
  const [captain, setCaptain] = useState('');
  const [eligibleMembers, setEligibleMembers] = useState<Member[]>([]);
  const [invitedMembers, setInvitedMembers] = useState<TeamMemberStatus[]>([]);
  const [selectedInvite, setSelectedInvite] = useState('');
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [isCaptain, setIsCaptain] = useState(false);
  const [joinedTeam, setJoinedTeam] = useState<any>(null);
  const [myStatus, setMyStatus] = useState<string | null>(null);
  const [allTeams, setAllTeams] = useState<any[]>([]);
  const [allTeamMembers, setAllTeamMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedMatch, setSelectedMatch] = useState(null);
  const [selectedMemberToRemove, setSelectedMemberToRemove] = useState<any>(null);
  const [isRemoveModalOpen, setIsRemoveModalOpen] = useState(false);
  const [removeLoading, setRemoveLoading] = useState(false);
  const [qrCodeModalOpen, setQrCodeModalOpen] = useState(false);
  const [qrCodeData, setQrCodeData] = useState('');

  // 假設有user context
  const user = JSON.parse(localStorage.getItem('loginUser') || '{}');

  // 處理邀請參數
  const params = new URLSearchParams(location.search);
  const inviteMemberId = params.get('invite');

  // 生成QR碼邀請
  const generateQRInvite = (memberId: string, memberName: string, teamId?: string) => {
    if (!contest_id) return;
    
    // 確定要使用的隊伍ID
    const targetTeamId = teamId || (joinedTeam ? joinedTeam.contest_team_id : null);
    if (!targetTeamId) {
      Modal.error({ title: '錯誤', content: '無法確定隊伍資訊' });
      return;
    }
    
    // 檢查是否為隊長或管理員
    const isCaptainOfTeam = allTeamMembers.some(
      (m: any) => m.contest_team_id === targetTeamId && 
           m.member_name === user.name && 
           m.status === 'captain'
    );

    const isAdmin = user.role === 'admin' || user.role === 'team_admin';

    if (!isCaptainOfTeam && !isAdmin) {
      Modal.error({ title: '錯誤', content: '只有隊長或管理員可以生成邀請碼' });
      return;
    }

    // 生成邀請數據
    const inviteData = {
      contest_id: contest_id,
      team_id: targetTeamId,
      member_id: memberId,
      timestamp: new Date().toISOString()
    };

    console.log('生成QR碼邀請數據:', inviteData);

    // 編碼邀請數據
    const encodedData = btoa(JSON.stringify(inviteData));
    
    // 生成邀請URL - 使用相對位置
    const baseUrl = window.location.origin;
    const inviteUrl = `${baseUrl}/qr-join?data=${encodedData}`;
    
    // 使用 Google Charts API 生成QR碼
    const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(inviteUrl)}`;
    
    console.log('QR碼URL:', qrCodeUrl);
    console.log('邀請URL:', inviteUrl);
    console.log('QR碼內容數據:', {
      contest_id: inviteData.contest_id,
      team_id: inviteData.team_id,
      member_id: inviteData.member_id,
      timestamp: inviteData.timestamp,
      encodedData: encodedData
    });
    
    setQrCodeData(qrCodeUrl);
    setQrCodeModalOpen(true);
  };

  // 處理邀請送出
  const handleInvite = async () => {
    if (!selectedInvite || !joinedTeam) return;
    setLoading(true);
    setError('');
    // 再次檢查是否已被邀請或已在隊伍中
    const alreadyInvited = invitedMembers.some((m: TeamMemberStatus) => m.member_id === selectedInvite && (m.status === 'invited' || m.status === 'accepted'));
    if (alreadyInvited) {
      setError('該成員已被邀請或已在隊伍中');
      setLoading(false);
      return;
    }
    const invitedMember = eligibleMembers.find((m: Member) => m.member_id === selectedInvite);
    if (!invitedMember) {
      setError('找不到該隊員');
      setLoading(false);
      return;
    }
    
    // 檢查用戶是否是該隊伍的隊長
    const isCaptainOfTeam = allTeamMembers.some(
      (m: any) => m.contest_team_id === joinedTeam.contest_team_id && 
           m.member_name === user.name && 
           m.status === 'captain'
    );

    if (!isCaptainOfTeam) {
      setError('只有隊長可以邀請成員');
      setLoading(false);
      return;
    }
    
    const { error: memberError } = await supabase
      .from('contest_team_member')
      .insert({
        contest_team_id: joinedTeam.contest_team_id,
        contest_id: joinedTeam.contest_id,
        member_id: invitedMember.member_id,
        member_name: invitedMember.name,
        status: 'invited',
      });
    setLoading(false);
    if (memberError) {
      setError('邀請失敗: ' + memberError.message);
    } else {
      setSelectedInvite('');
      setSuccess(true);
      fetchContestAndStatus();
    }
  };

  // 處理特定隊伍的邀請送出
  const handleInviteForTeam = async (teamId: string) => {
    if (!selectedInvite) return;
    setLoading(true);
    setError('');
    
    // 檢查用戶是否是該隊伍的隊長
    const isCaptainOfTeam = allTeamMembers.some(
      (m: any) => m.contest_team_id === teamId && 
           m.member_name === user.name && 
           m.status === 'captain'
    );

    if (!isCaptainOfTeam) {
      setError('只有隊長可以邀請成員');
      setLoading(false);
      return;
    }
    
    // 獲取正確的隊伍資訊
    const teamInfo = allTeams.find((t: any) => t.contest_team_id === teamId);
    if (!teamInfo) {
      setError('找不到隊伍資訊');
      setLoading(false);
      return;
    }
    
    // 再次檢查是否已被邀請或已在隊伍中
    const alreadyInvited = allTeamMembers.some(
      (m: any) => m.member_id === selectedInvite && 
                 m.contest_team_id === teamId && 
                 (m.status === 'invited' || m.status === 'accepted')
    );
    
    if (alreadyInvited) {
      setError('該成員已被邀請或已在隊伍中');
      setLoading(false);
      return;
    }
    
    const invitedMember = eligibleMembers.find((m: Member) => m.member_id === selectedInvite);
    if (!invitedMember) {
      setError('找不到該隊員');
      setLoading(false);
      return;
    }
    
    const { error: memberError } = await supabase
      .from('contest_team_member')
      .insert({
        contest_team_id: teamId,
        contest_id: typeof contest_id === 'string' ? parseInt(contest_id) : contest_id,
        member_id: invitedMember.member_id,
        member_name: invitedMember.name,
        status: 'invited',
      });
      
    setLoading(false);
    if (memberError) {
      setError('邀請失敗: ' + memberError.message);
    } else {
      setSelectedInvite('');
      setSuccess(true);
      fetchContestAndStatus();
    }
  };

  // 處理接受邀請
  useEffect(() => {
    const acceptInvite = async () => {
      if (inviteMemberId && user.name) {
        // 檢查是否是自己
        const { data: memberData, error: memberError } = await supabase
          .from('members')
          .select('name')
          .eq('member_id', inviteMemberId)
          .single();
        if (!memberError && memberData && memberData.name === user.name) {
          // 更新 contest_team_member 狀態
          await supabase
            .from('contest_team_member')
            .update({ status: 'accepted' })
            .eq('contest_id', contest_id)
            .eq('member_name', user.name);
          setMyStatus('accepted');
          setSuccess(true);
          setTimeout(() => setSuccess(false), 1200);
        }
      }
    };
    if (inviteMemberId) acceptInvite();
    // eslint-disable-next-line
  }, [inviteMemberId, contest_id, user.name]);

  // 建立隊伍
  const handleCreateTeam = async () => {
    console.group('[建立隊伍] 流程追蹤');
    console.log('輸入:', { teamName, userTeamId: user.team_id });

    if (!user) {
      Modal.error({ title: '錯誤', content: '請先登入' });
      return;
    }

    if (!user.team_id) {
      Modal.error({ title: '錯誤', content: '無法取得您的隊伍ID，請確認您已加入隊伍' });
      return;
    }

    if (!teamName.trim()) {
      Modal.error({ title: '錯誤', content: '請輸入隊伍名稱' });
      return;
    }

    // 檢查是否已有隊伍
    const { data: existingTeams, error: queryError } = await supabase
      .from('contest_team')
      .select('*')
      .eq('contest_id', contest_id)
      .eq('created_by', user.name);

    if (queryError) {
      console.error('查詢隊伍錯誤:', queryError);
      Modal.error({ title: '錯誤', content: queryError.message });
      return;
    }

    if (existingTeams && existingTeams.length > 0) {
      Modal.error({ title: '錯誤', content: '您已經建立過隊伍了' });
      return;
    }

    // 建立新隊伍
    const { data, error } = await supabase
      .from('contest_team')
      .insert({
        contest_id: contest_id,
        team_name: teamName.trim(),
        created_by: user.name,
        team_member_status: 'recruiting',
        team_id: user.team_id
      })
      .select();

    if (error) {
      console.error('建立失敗:', error);
      Modal.error({ title: '錯誤', content: error.message });
    } else {
      console.log('建立成功:', data);
      
      // 將自己添加為隊長到 contest_team_member 資料表
      if (data && data.length > 0) {
        const newTeamId = data[0].contest_team_id;
        const { error: memberError } = await supabase
          .from('contest_team_member')
          .insert({
            contest_team_id: newTeamId,
            contest_id: contest_id,
            member_id: user.member_id,
            member_name: user.name,
            status: 'captain'
          });
          
        if (memberError) {
          console.error('添加隊長失敗:', memberError);
          Modal.error({ title: '警告', content: '隊伍已建立，但添加您為隊長時出錯: ' + memberError.message });
        } else {
          console.log('成功添加隊長記錄');
          Modal.success({ 
            title: '成功', 
            content: '隊伍已建立，您已成為隊長',
            onOk: () => fetchContestAndStatus() // 關閉對話框後重新載入資料
          });
        }
      } else {
        Modal.success({ title: '成功', content: '隊伍已建立' });
      }
    }
    console.groupEnd();
  };

  const fetchContest = async () => {
    try {
      const { data, error } = await supabase
        .from('contest')
        .select('contest_id, contest_name, players_per_team')
        .eq('contest_id', typeof contest_id === 'string' ? parseInt(contest_id) : contest_id)
        .single();
      if (error) throw error;
      if (data) setContest(data);
    } catch (err) {
      console.error('獲取比賽數據錯誤:', err);
      setError('獲取比賽資料失敗');
    }
  };

  useEffect(() => {
    console.log('當前contest_id:', contest_id);
    if (!contest_id) {
      setError('比賽ID未提供');
      return;
    }
    fetchContest();
  }, [contest_id]);

  const fetchContestAndStatus = async () => {
    setLoading(true);
    setError('');
    try {
      // 並行查詢 contest, contest_team, contest_team_member, members
      const [contestRes, teamsRes, membersRes, allMembersRes] = await Promise.all([
        supabase
          .from('contest')
          .select('contest_id, contest_name, players_per_team, expected_teams')
          .eq('contest_id', typeof contest_id === 'string' ? parseInt(contest_id) : contest_id)
          .single(),
        supabase
          .from('contest_team')
          .select('contest_team_id, team_name, created_by, team_member_status, team_id')
          .eq('contest_id', typeof contest_id === 'string' ? parseInt(contest_id) : contest_id),
        supabase
          .from('contest_team_member')
          .select('contest_team_id, member_id, member_name, status, contest_id') // <--- 一定要有 contest_id
          .in('contest_team_id', []), // 先給空陣列，稍後根據 teamIds 查詢
        supabase
          .from('members')
          .select('member_id, name, team_id') // 加入 team_id 欄位
          .order('name', { ascending: true }),
      ]);

      // 處理 contest
      if (contestRes.error) throw contestRes.error;
      setContest(contestRes.data);
      const expectedTeams = contestRes.data.expected_teams;

      // 處理 teams
      if (teamsRes.error) throw teamsRes.error;
      setAllTeams(teamsRes.data || []);
      const teamIds = (teamsRes.data || []).map((t: any) => t.contest_team_id) || [];

      // 處理 allTeamMembers
      let allMembers: any[] = [];
      if (teamIds.length > 0) {
        const { data: allTeamMembers, error: allTeamMembersError } = await supabase
          .from('contest_team_member')
          .select('contest_team_id, member_id, member_name, status, contest_id') // <--- 一定要有 contest_id
          .in('contest_team_id', teamIds);
        if (allTeamMembersError) throw allTeamMembersError;
        allMembers = allTeamMembers || [];
        setAllTeamMembers(allMembers);
        console.log('allTeamMembers:', allMembers); // 新增 log，含 contest_id
      } else {
        setAllTeamMembers([]);
      }

      // 查自己是否在這些隊伍裡
      let joinedTeamId = null;
      if (teamIds.length > 0) {
        const { data: myTeamMemberRows } = await supabase
          .from('contest_team_member')
          .select('contest_team_id')
          .in('contest_team_id', teamIds)
          .eq('member_name', user.name);
        joinedTeamId = myTeamMemberRows && myTeamMemberRows.length > 0 ? myTeamMemberRows[0].contest_team_id : null;
      }

      if (joinedTeamId) {
        // 查隊伍資訊
        const { data: teamData } = await supabase
          .from('contest_team')
          .select('*')
          .eq('contest_team_id', joinedTeamId)
          .single();
        setJoinedTeam(teamData);

        // 查所有隊員狀態
        const myTeamMembers = allMembers.filter((m: any) => m.contest_team_id === joinedTeamId);
        setInvitedMembers(myTeamMembers || []);

        // 處理 eligibleMembers（重新定義）
        // 步驟1：限定同 team_id
        const sameTeamMembers = (allMembersRes.data || []).filter(
          (m: any) => m.team_id === user.team_id
        );
        // 步驟2：排除本 contest_id 且 status=accepted 的 member
        const acceptedMemberIds = (allTeamMembers || [])
          .filter(
            (tm: any) =>
              tm.contest_id === (typeof contest_id === 'string' ? parseInt(contest_id) : contest_id) &&
              tm.status === 'accepted'
          )
          .map((tm: any) => tm.member_id);
        // 步驟3：排除同隊伍且 status=invited 的 member
        const invitedMemberIds = (allTeamMembers || [])
          .filter(
            (tm: any) =>
              tm.contest_team_id === joinedTeamId &&
              tm.status === 'invited'
          )
          .map((tm: any) => tm.member_id);
        const eligibleMembers = sameTeamMembers.filter(
          (m: any) => !acceptedMemberIds.includes(m.member_id) && !invitedMemberIds.includes(m.member_id)
        );
        // Debug log
        console.log('[過濾條件-1] members.team_id ===', user.team_id);
        console.log('[過濾條件-2] 排除 contest_team_member.contest_id ===', contest_id, '且 status=accepted 的 member_id:', acceptedMemberIds);
        console.log('[過濾條件-3] 排除 contest_team_member.contest_team_id ===', joinedTeamId, '且 status=invited 的 member_id:', invitedMemberIds);
        console.log('eligibleMembers:', eligibleMembers);
        setEligibleMembers(eligibleMembers);
      } else {
        setJoinedTeam(null);
        setInvitedMembers([]);
        // 處理 eligibleMembers（重新定義）
        // 步驟1：限定同 team_id
        const sameTeamMembers = (allMembersRes.data || []).filter(
          (m: any) => m.team_id === user.team_id
        );
        // 步驟2：排除本 contest_id 且 status=accepted 的 member
        const acceptedMemberIds = (allTeamMembers || [])
          .filter(
            (tm: any) =>
              tm.contest_id === (typeof contest_id === 'string' ? parseInt(contest_id) : contest_id) &&
              tm.status === 'accepted'
          )
          .map((tm: any) => tm.member_id);
        // 步驟3：排除同隊伍且 status=invited 的 member
        const invitedMemberIds = (allTeamMembers || [])
          .filter(
            (tm: any) =>
              tm.contest_team_id === joinedTeamId &&
              tm.status === 'invited'
          )
          .map((tm: any) => tm.member_id);
        const eligibleMembers = sameTeamMembers.filter(
          (m: any) => !acceptedMemberIds.includes(m.member_id) && !invitedMemberIds.includes(m.member_id)
        );
        // Debug log
        console.log('[過濾條件-1] members.team_id ===', user.team_id);
        console.log('[過濾條件-2] 排除 contest_team_member.contest_id ===', contest_id, '且 status=accepted 的 member_id:', acceptedMemberIds);
        console.log('[過濾條件-3] 排除 contest_team_member.contest_team_id ===', joinedTeamId, '且 status=invited 的 member_id:', invitedMemberIds);
        console.log('eligibleMembers:', eligibleMembers);
        setEligibleMembers(eligibleMembers);
        console.log('eligibleMembers (no team):', allMembersRes.data);
      }
    } catch (err: any) {
      console.error('數據獲取錯誤:', err);
      setError('獲取資料失敗: ' + (err.message || JSON.stringify(err)));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (contest_id && user.name) {
      fetchContestAndStatus();
    }
  }, [contest_id, user.name, user.team_id]);

  useEffect(() => {
    // 追蹤 isCaptain 狀態
    if (allTeamMembers && user && contest_id) {
      const myMember = allTeamMembers.find(
        (m: any) =>
          m.member_name === user.name &&
          m.status === 'captain'
      );
      setIsCaptain(!!myMember);
      console.log('isCaptain 判斷用 myMember:', myMember);
    }
    console.log('isCaptain 狀態:', isCaptain);
    console.log('user.name:', user.name);
  }, [allTeamMembers, user, contest_id]);

  useEffect(() => {
    console.groupCollapsed('[ContestJoinPage] 使用者團隊狀態');
    console.table({
      '使用者ID': user?.member_id,
      '隊伍ID': user?.team_id,
      '是否隊長': user?.is_captain,
      '當前比賽': contest?.contest_name
    });
    console.groupEnd();
  }, [user]);

  const handleJoinTeam = async (contest_team_id: string) => {
    setLoading(true);
    setError('');
    try {
      // 新增：防止同一人在同一比賽加入多隊
      const { data: existRowsInContest } = await supabase
        .from('contest_team_member')
        .select()
        .eq('contest_id', typeof contest_id === 'string' ? parseInt(contest_id) : contest_id)
        .eq('member_id', user.member_id)
        .in('status', ['accepted', 'captain']);
      
      if (existRowsInContest && existRowsInContest.length > 0) {
        setError('您已經加入過本比賽的其他隊伍，無法重複加入');
        setLoading(false);
        return;
      }

      // 檢查是否已在這個隊伍（可選，防止重複點擊）
      const { data: existRows } = await supabase
        .from('contest_team_member')
        .select()
        .eq('contest_team_id', contest_team_id)
        .eq('member_id', user.member_id);

      if (existRows && existRows.length > 0) {
        setError('您已經在此隊伍中');
        setLoading(false);
        return;
      }

      // 加入隊伍
      const { error } = await supabase
        .from('contest_team_member')
        .insert({
          contest_team_id,
          contest_id: typeof contest_id === 'string' ? parseInt(contest_id) : contest_id,
          member_id: user.member_id,
          member_name: user.name,
          status: 'accepted'
        });

      if (error) throw error;
      await fetchContestAndStatus();
    } catch (err) {
      console.error('加入隊伍錯誤:', err);
      setError(`加入隊伍失敗: ${err instanceof Error ? err.message : JSON.stringify(err)}`);
    } finally {
      setLoading(false);
    }
  };

  const handleRespondInvite = (match: SelectedMatch) => {
    setSelectedMatch(match);
    setIsModalOpen(true);
  };

  const handleAccept = () => {
    // TODO: 呼叫 API 更新邀約狀態為已接受
    setIsModalOpen(false);
    // 可加上通知或重新整理資料
  };

  const handleReject = () => {
    // TODO: 呼叫 API 更新邀約狀態為已拒絕
    setIsModalOpen(false);
    // 可加上通知或重新整理資料
  };

  // --- 新增：接受邀約功能 ---
  const handleAcceptInvite = async () => {
    const myMember = allTeamMembers.find(
      (m: any) => normalize(m.member_name) === normalize(user.name) && (m.status === 'invited' || m.status === 'pending')
    );
    if (!myMember) {
      Modal.error({ title: '錯誤', content: '找不到您的邀請紀錄' });
      return;
    }
    const { error } = await supabase
      .from('contest_team_member')
      .update({ status: 'accepted', responded_at: new Date().toISOString() })
      .eq('contest_team_id', myMember.contest_team_id)
      .eq('member_name', user.name); // 用資料庫原始名稱
    if (error) {
      Modal.error({ title: '錯誤', content: error.message });
    } else {
      Modal.success({ title: '成功', content: '已接受邀約！' });
      window.location.reload();
    }
  };

  // 加入拒絕邀約的處理函數
  const handleRejectInvite = async () => {
    if (!user || !user.name) {
      Modal.error({ title: '錯誤', content: '請先登入' });
      return;
    }

    const myMember = allTeamMembers.find(
      (m: any) => normalize(m.member_name) === normalize(user.name) && (m.status === 'invited' || m.status === 'pending')
    );

    if (!myMember) {
      Modal.error({ title: '錯誤', content: '找不到您的邀請紀錄' });
      return;
    }

    try {
      const { error } = await supabase
        .from('contest_team_member')
        .update({ 
          status: 'rejected',
          responded_at: new Date().toISOString()
        })
        .eq('contest_team_id', myMember.contest_team_id)
        .eq('member_name', user.name);

      if (error) {
        Modal.error({ title: '錯誤', content: error.message });
        return;
      }

      Modal.success({ title: '成功', content: '已拒絕邀約' });
      
      // 重新整理資料
      setJoinedTeam(null);
      setInvitedMembers([]);
      setMyStatus(null);
      await fetchContestAndStatus();
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : '未知錯誤';
      Modal.error({ title: '錯誤', content: '操作失敗: ' + errorMessage });
    }
  };

  // --- 新增 normalize 函式，解決全形/半形/空白問題 ---
  const normalize = (str: string) => (str || '').replace(/[\s　]/g, '').trim();

  // 修改移除成員的處理函數
  const handleRemoveMember = async () => {
    if (!selectedMemberToRemove) return;
    // 先顯示訊息視窗，顯示刪除者資訊
    Modal.info({
      title: '執行刪除動作',
      content: (
        <div>
          <div>執行刪除者：</div>
          <div>姓名：{user.name}</div>
          <div>會員ID：{user.member_id}</div>
        </div>
      ),
      okText: '確定',
      onOk: async () => {
        setRemoveLoading(true);
        try {
          // 先確認當前用戶是否為該隊伍的隊長
          const { data: captainCheck } = await supabase
            .from('contest_team_member')
            .select('status, contest_team_id')
            .eq('contest_team_id', selectedMemberToRemove.contest_team_id)
            .eq('member_name', user.name)
            .single();

          if (!captainCheck || captainCheck.status !== 'captain' || 
              captainCheck.contest_team_id !== selectedMemberToRemove.contest_team_id) {
            throw new Error('您不是該隊伍的隊長，無法移除隊員');
          }

          console.log('準備移除隊員：', selectedMemberToRemove);
          const { error } = await supabase
            .from('contest_team_member')
            .delete()
            .eq('contest_team_id', selectedMemberToRemove.contest_team_id)
            .eq('member_name', selectedMemberToRemove.member_name)
            .eq('contest_id', selectedMemberToRemove.contest_id);

          if (error) throw error;
          Modal.success({ title: '成功', content: '已成功移除隊員' });
          setIsRemoveModalOpen(false);
          await fetchContestAndStatus();
        } catch (err: unknown) {
          const errorMessage = err instanceof Error ? err.message : '未知錯誤';
          Modal.error({ title: '移除失敗', content: '移除失敗: ' + errorMessage });
        } finally {
          setRemoveLoading(false);
        }
      }
    });
  };

  const handleAcceptInviteForTeam = async (contest_team_id: string) => {
    const myMember = allTeamMembers.find(
      (m: TeamMember) => normalize(m.member_name) === normalize(user.name) && (m.status === 'invited' || m.status === 'pending')
    );
    if (!myMember) {
      Modal.error({ title: '錯誤', content: '找不到您的邀請紀錄' });
      return;
    }
    const { error } = await supabase
      .from('contest_team_member')
      .update({ status: 'accepted', responded_at: new Date().toISOString() })
      .eq('contest_team_id', contest_team_id)
      .eq('member_name', myMember.member_name);
    if (error) {
      Modal.error({ title: '錯誤', content: error.message });
    } else {
      Modal.success({ title: '成功', content: '已接受邀約！' });
      window.location.reload();
    }
  };

  const handleRejectInviteForTeam = async (contest_team_id: string) => {
    const myMember = allTeamMembers.find(
      (m: TeamMember) => normalize(m.member_name) === normalize(user.name) && (m.status === 'invited' || m.status === 'pending')
    );
    if (!myMember) {
      Modal.error({ title: '錯誤', content: '找不到您的邀請紀錄' });
      return;
    }
    const { error } = await supabase
      .from('contest_team_member')
      .update({ 
        status: 'rejected',
        responded_at: new Date().toISOString()
      })
      .eq('contest_team_id', contest_team_id)
      .eq('member_name', myMember.member_name);

    if (error) {
      Modal.error({ title: '錯誤', content: error.message });
    } else {
      Modal.success({ title: '成功', content: '已拒絕邀約' });
      // 重新整理資料，清除當前隊伍狀態
      setJoinedTeam(null);
      setInvitedMembers([]);
      setMyStatus(null);
      fetchContestAndStatus();
    }
  };

  const handleSelectChange = (e: ChangeEvent<HTMLSelectElement>) => {
    setSelectedInvite(e.target.value);
  };

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    setTeamName(e.target.value);
  };

  if (loading) return <div className="p-4 text-center">載入中...</div>;
  if (error) return (
    <div className="p-4 text-center">
      <div className="text-red-600 mb-4">{error}</div>
      <button
        className="mt-2 bg-gray-500 text-white px-4 py-2 rounded"
        onClick={() => navigate(-1)}
      >
        ← 回上頁
      </button>
    </div>
  );
  if (!contest) {
    return (
      <div className="p-4 text-center">
        找不到比賽資料
        <button
          className="mt-2 bg-blue-500 text-white px-4 py-2 rounded"
          onClick={() => fetchContest()}
        >
          重試
        </button>
      </div>
    );
  }

  // 判斷登入者是否已在本比賽任何隊伍（排除 rejected 狀態）
  const userInAnyTeam = allTeamMembers && user && (
    allTeamMembers.some(
      (m: any) =>
        (m.member_id === user.member_id || (normalize && normalize(m.member_name) === normalize(user.name))) &&
        (m.status === 'accepted' || m.status === 'captain') // 不包含 rejected
    )
  );
  
  // 判斷登入者是否已經是本比賽中某個隊伍的隊長
  const userIsCaptainInContest = allTeamMembers && user && (
    allTeamMembers.some(
      (m: any) =>
        (m.member_id === user.member_id || (normalize && normalize(m.member_name) === normalize(user.name))) &&
        m.status === 'captain' &&
        m.contest_id === (typeof contest_id === 'string' ? parseInt(contest_id) : contest_id)
    )
  );
  
  // 判斷是否可建立新隊伍
  const canCreateTeam =
    !userInAnyTeam &&
    allTeams && contest && allTeams.length < contest.expected_teams;

  // 1. 已經在隊伍中，只顯示自己的隊伍與成員
  if (joinedTeam && myStatus === 'accepted') {
    const myTeamMembers = allTeamMembers.filter((m: any) => m.contest_team_id === joinedTeam.contest_team_id);
    return (
      <div>
        <div className="p-4 bg-gray-100 flex justify-between items-center">
          <button
            onClick={() => navigate(-1)}
            className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 flex items-center"
          >
            ← 回上頁
          </button>
          <span className="text-gray-600">登入者：{user.name || '未登入'}</span>
        </div>
        <div className="max-w-lg mx-auto mt-8 p-6 bg-white rounded shadow">
          <h2 className="text-2xl font-bold mb-4">報名：{contest.contest_name}</h2>
          <div className="mb-4">
            <b>隊伍名稱：</b>{joinedTeam.team_name}<br />
            <b>隊長：</b>{joinedTeam.created_by}
          </div>
          <div className="mb-4">
            隊員列表：
            {myTeamMembers.filter(m => m.status !== 'captain').length === 0 ? (
              <span>暫無隊員</span>
            ) : (
              <ul>
                {myTeamMembers.filter(m => m.status !== 'captain').map((m: any) => (
                  <li key={m.member_name} className="flex justify-between items-center">
                    <span>
                      {m.member_name}（
                        {m.status === 'pending' || m.status === 'invited' ? '待回覆' :
                         m.status === 'accepted' ? '已接受' :
                         m.status === 'reject' ? '謝絕' : m.status}
                      ）
                    </span>
                    {(m.status === 'invited' || m.status === 'rejected') && (allTeamMembers.some(captain => 
                      captain.contest_team_id === joinedTeam.contest_team_id && 
                      captain.member_name === user.name && 
                      captain.status === 'captain'
                    ) || user.role === 'admin' || user.role === 'team_admin') && (
                      <Button 
                        type="link" 
                        size="small"
                        onClick={() => generateQRInvite(m.member_id, m.member_name)}
                      >
                        生成邀請碼
                      </Button>
                    )}
                    {m.contest_team_id === joinedTeam.contest_team_id && // 確保是同一隊伍
                     allTeamMembers.some(captain => 
                       captain.contest_team_id === joinedTeam.contest_team_id && 
                       captain.member_name === user.name && 
                       captain.status === 'captain'
                     ) && 
                     m.status === 'accepted' && 
                     m.member_name !== user.name && (
                      <Button 
                        type="text" 
                        danger
                        onClick={() => {
                          Modal.confirm({
                            title: '確認移除隊員',
                            content: `確定要移除 ${m.member_name} 嗎？`,
                            okText: '確認移除',
                            cancelText: '取消',
                            onOk: async () => {
                              try {
                                const { error } = await supabase
                                  .from('contest_team_member')
                                  .delete()
                                  .eq('contest_team_id', m.contest_team_id)
                                  .eq('member_name', m.member_name)
                                  .eq('contest_id', typeof contest_id === 'string' ? parseInt(contest_id) : contest_id);

                                if (error) throw error;
                                Modal.success({ title: '成功', content: '已成功移除隊員' });
                                await fetchContestAndStatus();
                              } catch (err) {
                                Modal.error({ 
                                  title: '移除失敗', 
                                  content: '移除失敗: ' + (err instanceof Error ? err.message : '未知錯誤') 
                                });
                              }
                            }
                          });
                        }}
                      >
                        移除
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {myTeamMembers.some(
              (m: any) => normalize(m.member_name) === normalize(user.name) && (m.status === 'invited' || m.status === 'pending')
            ) && (
              <div style={{ marginTop: 12, display: 'flex', gap: '8px' }}>
                <Button type="primary" onClick={handleAcceptInvite}>
                  接受邀約
                </Button>
                <Button type="default" danger onClick={handleRejectInvite}>
                  不克參加
                </Button>
              </div>
            )}
          </div>
          {allTeamMembers.some(captain => 
            captain.contest_team_id === joinedTeam.contest_team_id && 
            captain.member_name === user.name && 
            captain.status === 'captain'
          ) && (
            <div style={{ marginTop: 16 }}>
              <b>邀請成員：</b>
              <select
                value={selectedInvite}
                onChange={handleSelectChange}
                style={{ marginRight: 8 }}
              >
                <option value="">請選擇成員</option>
                {eligibleMembers
                  .filter((m: Member) => m && m.name)
                  .map((m: Member) => (
                    <option key={m.member_id} value={m.member_id}>
                      {m.name}
                    </option>
                  ))}
              </select>
              <Button
                type="default"
                disabled={!selectedInvite}
                onClick={() => handleInviteForTeam(joinedTeam.contest_team_id)}
              >
                邀請
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // 2. 有多個邀請，顯示所有邀請此人的隊伍
  const invitedTeams = allTeams.filter((team: Team) =>
    allTeamMembers.some(
      (m: TeamMember) => m.contest_team_id === team.contest_team_id &&
        (m.member_id === user.member_id || (normalize && normalize(m.member_name) === normalize(user.name))) &&
        (m.status === 'invited' || m.status === 'pending')
    )
  );

  if (invitedTeams.length > 0) {
    return (
      <div>
        <div className="p-4 bg-gray-100 flex justify-between items-center">
          <button
            onClick={() => navigate(-1)}
            className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 flex items-center"
          >
            ← 回上頁
          </button>
          <span className="text-gray-600">登入者：{user.name || '未登入'}</span>
        </div>
        <div className="max-w-lg mx-auto mt-8 p-6 bg-white rounded shadow">
          <h2 className="text-2xl font-bold mb-4">報名：{contest.contest_name}</h2>
          {invitedTeams.map((team: Team) => {
            const members = allTeamMembers.filter((m: TeamMember) => m.contest_team_id === team.contest_team_id);
            return (
              <div key={team.contest_team_id} className="border rounded p-2 mb-4">
                <div className="flex justify-between items-center mb-2">
                  <div>
                    <b>隊伍名稱：</b>{team.team_name}
                  </div>
                  {allTeamMembers.some(captain => 
                    captain.contest_team_id === team.contest_team_id && 
                    captain.member_name === user.name && 
                    captain.status === 'captain'
                  ) && members.filter(m => m.status === 'accepted' || m.status === 'captain').length >= (contest?.players_per_team || 0) && team.team_member_status !== 'done' && (
                    <Button
                      type="primary"
                      onClick={async () => {
                        try {
                          const { error } = await supabase
                            .from('contest_team')
                            .update({ team_member_status: 'done' })
                            .eq('contest_team_id', team.contest_team_id);
                          
                          if (error) {
                            Modal.error({ title: '錯誤', content: '更新隊伍狀態失敗: ' + error.message });
                          } else {
                            Modal.success({ title: '成功', content: '已確認隊伍人員已到位！' });
                            await fetchContestAndStatus();
                          }
                        } catch (err) {
                          Modal.error({ title: '錯誤', content: '操作失敗: ' + (err instanceof Error ? err.message : '未知錯誤') });
                        }
                      }}
                    >
                      人員已到位
                    </Button>
                  )}
                </div>
                <div><b>隊長：</b>{team.created_by}</div>
                {team.team_member_status === 'done' && (
                  <div className="text-green-600 font-medium mt-2 mb-2">✓ 已確認人員到位</div>
                )}
                <div>
                  隊員列表：
                  {members.filter(m => m.status !== 'captain').length === 0 ? (
                    <span>暫無隊員</span>
                  ) : (
                    <ul>
                      {members.filter(m => m.status !== 'captain').map((m: TeamMember) => (
                        <li key={m.member_name} className="flex justify-between items-center">
                          <span>
                            {m.member_name}（
                              {m.status === 'pending' || m.status === 'invited' ? '待回覆' :
                               m.status === 'accepted' ? '已接受' :
                               m.status === 'reject' ? '謝絕' : m.status}
                            ）
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {/* 只針對自己是 invited/pending 狀態顯示按鈕 */}
                  {members.some(
                    (m: TeamMember) => (m.member_id === user.member_id || (normalize && normalize(m.member_name) === normalize(user.name))) && (m.status === 'invited' || m.status === 'pending')
                  ) && (
                    <div style={{ marginTop: 12, display: 'flex', gap: '8px' }}>
                      <Button type="primary" onClick={() => handleAcceptInviteForTeam(team.contest_team_id)}>
                        接受邀約
                      </Button>
                      <Button type="default" danger onClick={() => handleRejectInviteForTeam(team.contest_team_id)}>
                        不克參加
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {/* 修正：即使有邀請，只要 canCreateTeam 也要顯示建立隊伍 UI */}
          {canCreateTeam && (
            <div className="mb-4 border rounded p-4 mt-6">
              <b>建立隊伍</b>
              <div className="mt-2">隊名：</div>
              <input
                className="border px-2 py-1 rounded w-full mb-2"
                value={teamName}
                onChange={handleInputChange}
                placeholder="請輸入隊伍名稱"
              />
              <button
                className="bg-blue-600 text-white px-4 py-2 rounded"
                onClick={handleCreateTeam}
              >
                建立隊伍並成為隊長
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // 2. 未加入任何隊伍，顯示所有隊伍（含成員）與加入鈕
  const acceptedNames = allTeamMembers
    .filter((m: any) => m.status === 'accepted')
    .map((m: any) => normalize(m.member_name));

  return (
    <div>
      <div className="p-4 bg-gray-100 flex justify-between items-center">
        <button
          onClick={() => navigate(-1)}
          className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 flex items-center"
        >
          ← 回上頁
        </button>
        <span className="text-gray-600">登入者：{user.name || '未登入'}</span>
      </div>
      <div className="max-w-lg mx-auto mt-8 p-6 bg-white rounded shadow">
        <h2 className="text-2xl font-bold mb-4">報名：{contest.contest_name}</h2>
        <div className="mb-6">
          <b>現有隊伍</b>
          {allTeams.length === 0 && <div>目前尚無隊伍</div>}
          {allTeams.map((team: Team) => {
            const members = allTeamMembers.filter((m: TeamMember) => m.contest_team_id === team.contest_team_id);
            return (
              <div key={team.contest_team_id} className="border rounded p-2 mb-2">
                <div className="flex justify-between items-center mb-2">
                  <div>
                    <b>隊伍名稱：</b>{team.team_name}
                  </div>
                  {allTeamMembers.some(captain => 
                    captain.contest_team_id === team.contest_team_id && 
                    captain.member_name === user.name && 
                    captain.status === 'captain'
                  ) && members.filter(m => m.status === 'accepted' || m.status === 'captain').length >= (contest?.players_per_team || 0) && team.team_member_status !== 'done' && (
                    <Button
                      type="primary"
                      onClick={async () => {
                        try {
                          const { error } = await supabase
                            .from('contest_team')
                            .update({ team_member_status: 'done' })
                            .eq('contest_team_id', team.contest_team_id);
                          
                          if (error) {
                            Modal.error({ title: '錯誤', content: '更新隊伍狀態失敗: ' + error.message });
                          } else {
                            Modal.success({ title: '成功', content: '已確認隊伍人員已到位！' });
                            await fetchContestAndStatus();
                          }
                        } catch (err) {
                          Modal.error({ title: '錯誤', content: '操作失敗: ' + (err instanceof Error ? err.message : '未知錯誤') });
                        }
                      }}
                    >
                      人員已到位
                    </Button>
                  )}
                </div>
                <div><b>隊長：</b>{team.created_by}</div>
                {team.team_member_status === 'done' && (
                  <div className="text-green-600 font-medium mt-2 mb-2">✓ 已確認人員到位</div>
                )}
                <div>
                  隊員列表：
                  {members.filter(m => m.status !== 'captain').length === 0 ? (
                    <span>暫無隊員</span>
                  ) : (
                    <ul>
                      {members.filter(m => m.status !== 'captain').map((m: TeamMember) => (
                        <li key={m.member_name} className="flex justify-between items-center">
                          <span>
                            {m.member_name}（
                              {m.status === 'pending' || m.status === 'invited' ? '待回覆' :
                               m.status === 'captain' ? '隊長' :
                               m.status === 'accepted' ? '已接受' :
                               m.status === 'reject' ? '謝絕' : m.status}
                            ）
                          </span>
                          {(m.status === 'invited' || m.status === 'rejected') && (allTeamMembers.some(captain => 
                            captain.contest_team_id === team.contest_team_id && 
                            captain.member_name === user.name && 
                            captain.status === 'captain'
                          ) || user.role === 'admin' || user.role === 'team_admin') && (
                            <Button 
                              type="link" 
                              size="small"
                              onClick={() => generateQRInvite(m.member_id, m.member_name, team.contest_team_id)}
                            >
                              生成邀請碼
                            </Button>
                          )}
                          {m.contest_team_id === team.contest_team_id && // 確保是同一隊伍
                           allTeamMembers.some(captain => 
                             captain.contest_team_id === team.contest_team_id && 
                             captain.member_name === user.name && 
                             captain.status === 'captain'
                           ) && 
                           m.status === 'accepted' && 
                           m.member_name !== user.name && (
                            <Button 
                              type="text" 
                              danger
                              onClick={() => {
                                Modal.confirm({
                                  title: '確認移除隊員',
                                  content: `確定要移除 ${m.member_name} 嗎？`,
                                  okText: '確認移除',
                                  cancelText: '取消',
                                  onOk: async () => {
                                    try {
                                      const { error } = await supabase
                                        .from('contest_team_member')
                                        .delete()
                                        .eq('contest_team_id', m.contest_team_id)
                                        .eq('member_name', m.member_name)
                                        .eq('contest_id', typeof contest_id === 'string' ? parseInt(contest_id) : contest_id);

                                      if (error) throw error;
                                      Modal.success({ title: '成功', content: '已成功移除隊員' });
                                      await fetchContestAndStatus();
                                    } catch (err) {
                                      Modal.error({ 
                                        title: '移除失敗', 
                                        content: '移除失敗: ' + (err instanceof Error ? err.message : '未知錯誤') 
                                      });
                                    }
                                  }
                                });
                              }}
                            >
                              移除
                            </Button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {members.some(
                    (m: TeamMember) => normalize(m.member_name) === normalize(user.name) && (m.status === 'invited' || m.status === 'pending')
                  ) && (
                    <div style={{ marginTop: 12, display: 'flex', gap: '8px' }}>
                      <Button type="primary" onClick={handleAcceptInvite}>
                        接受邀約
                      </Button>
                      <Button type="default" danger onClick={handleRejectInvite}>
                        不克參加
                      </Button>
                    </div>
                  )}
                </div>
                {members.some(
                  (m: TeamMember) => normalize(m.member_name) === normalize(user.name) && (m.status === 'invited' || m.status === 'pending')
                ) ? (
                  <Button type="primary" onClick={() => handleRespondInvite({
                    contest_name: contest?.contest_name || '',
                    team_name: team.team_name,
                    created_by: team.created_by
                  })}>
                    回應邀約
                  </Button>
                ) : (
                  !userIsCaptainInContest && 
                  !members.some(
                    (m: TeamMember) => normalize(m.member_name) === normalize(user.name) && m.status === 'captain'
                  ) && (
                    <Button
                      className="mt-2 bg-green-500 text-white px-4 py-1 rounded"
                      onClick={() => handleJoinTeam(team.contest_team_id)}
                    >
                      參賽
                    </Button>
                  )
                )}
                {allTeamMembers.some(captain => 
                  captain.contest_team_id === team.contest_team_id && 
                  captain.member_name === user.name && 
                  captain.status === 'captain'
                ) && (
                  <div style={{ marginTop: 16 }}>
                    <b>邀請成員：</b>
                    <select
                      value={selectedInvite}
                      onChange={handleSelectChange}
                      style={{ marginRight: 8 }}
                    >
                      <option value="">請選擇成員</option>
                      {eligibleMembers
                        .filter((m: Member) => m && m.name)
                        .map((m: Member) => (
                          <option key={m.member_id} value={m.member_id}>
                            {m.name}
                          </option>
                        ))}
                    </select>
                    <Button
                      type="default"
                      disabled={!selectedInvite}
                      onClick={() => handleInviteForTeam(team.contest_team_id)}
                    >
                      邀請
                    </Button>
                  </div>
                )}
                <hr />
              </div>
            );
          })}
        </div>
        {canCreateTeam && (
          <div className="mb-4">
            <b>建立隊伍</b>
            <div className="mt-2">隊名：</div>
            <input
              className="border px-2 py-1 rounded w-full mb-2"
              value={teamName}
              onChange={handleInputChange}
              placeholder="請輸入隊伍名稱"
            />
            <button
              className="bg-blue-600 text-white px-4 py-2 rounded"
              onClick={handleCreateTeam}
            >
              建立隊伍並成為隊長
            </button>
          </div>
        )}
      </div>
      {/* 回應邀約 Modal */}
      <Modal
        open={isModalOpen}
        onCancel={() => setIsModalOpen(false)}
        footer={null}
      >
        <h3>回應邀約</h3>
        {selectedMatch && (
          <div>
            <div>比賽名稱：{selectedMatch.contest_name}</div>
            <div>隊伍名稱：{selectedMatch.team_name}</div>
            <div>邀請人：{selectedMatch.created_by}</div>
          </div>
        )}
        <div style={{ marginTop: 24, display: 'flex', gap: 16 }}>
          <Button type="primary" onClick={handleAccept}>接受邀約</Button>
          <Button danger onClick={handleReject}>拒絕邀約</Button>
        </div>
      </Modal>
      {/* 加入移除確認 Modal */}
      <Modal
        title="確認移除隊員"
        open={isRemoveModalOpen}
        onOk={handleRemoveMember}
        onCancel={() => setIsRemoveModalOpen(false)}
        okText="確認移除"
        cancelText="取消"
        zIndex={1001}
        maskClosable={false}
        destroyOnClose
      >
        <p>確定要移除 {selectedMemberToRemove?.member_name} 嗎？</p>
      </Modal>

      {/* QR碼邀請 Modal */}
      <Modal
        title="邀請QR碼"
        open={qrCodeModalOpen}
        onCancel={() => setQrCodeModalOpen(false)}
        footer={[
          <Button key="close" onClick={() => setQrCodeModalOpen(false)}>
            關閉
          </Button>
        ]}
        width={400}
        centered
      >
        <div style={{ textAlign: 'center', padding: '20px' }}>
          <p style={{ marginBottom: '20px' }}>請讓隊員掃描此QR碼加入隊伍</p>
          {qrCodeData && (
            <img 
              src={qrCodeData} 
              alt="邀請QR碼" 
              style={{ maxWidth: '100%', height: 'auto' }}
            />
          )}
          <p style={{ marginTop: '20px', fontSize: '12px', color: '#666' }}>
            隊員掃碼後將直接跳轉到加入頁面
          </p>
        </div>
      </Modal>
    </div>
  );
};

export default ContestJoinPage;
