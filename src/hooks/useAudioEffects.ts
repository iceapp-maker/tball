import { useState, useRef, useEffect } from 'react';

/**
 * 音效處理 Hook
 * 提供音效狀態管理和音效播放功能
 */
export const useAudioEffects = () => {
  // 音效啟用狀態
  const [soundEnabled, setSoundEnabled] = useState(true);
  
  // AudioContext 引用
  const audioContextRef = useRef<AudioContext | null>(null);
  
  // 初始化 AudioContext
  const getAudioContext = () => {
    if (!audioContextRef.current) {
      // 使用標準 AudioContext 或針對舊瀏覽器的 webkitAudioContext
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        audioContextRef.current = new AudioContextClass();
      }
    }
    return audioContextRef.current;
  };
  
  // 創建蜂鳴音效
  const createBeepSound = (
    frequency = 700, 
    duration = 150, 
    volume = 0.5, 
    type: OscillatorType = 'sine'
  ) => {
    if (!soundEnabled) return;
    
    try {
      const audioContext = getAudioContext();
      if (!audioContext) return;
      
      // Resume audio context if it's suspended (browser requirement)
      if (audioContext.state === 'suspended') {
        audioContext.resume();
      }
      
      // Create oscillator and gain nodes
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      // Configure the oscillator
      oscillator.type = type;
      oscillator.frequency.value = frequency;
      
      // Configure volume
      gainNode.gain.value = volume;
      
      // To avoid clicks, ramp volume up and down
      gainNode.gain.setValueAtTime(0, audioContext.currentTime);
      gainNode.gain.linearRampToValueAtTime(volume, audioContext.currentTime + 0.01);
      gainNode.gain.linearRampToValueAtTime(0, audioContext.currentTime + duration / 1000);
      
      // Connect the nodes
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      // Start and stop the oscillator
      oscillator.start();
      oscillator.stop(audioContext.currentTime + duration / 1000);
    } catch (error) {
      console.log("Audio generation error:", error);
    }
  };
  
  // 得分音效 - 高頻短音
  const playScoreSound = () => {
    createBeepSound(800, 80, 0.3, 'sine');
  };
  
  // 交換方位音效 - 中頻中長音
  const playSwitchSound = () => {
    createBeepSound(500, 120, 0.3, 'triangle');
  };
  
  // 遊戲結束音效 - 三個音的序列
  const playGameOverSound = () => {
    createBeepSound(600, 120, 0.3, 'triangle');
    setTimeout(() => {
      createBeepSound(700, 120, 0.3, 'triangle');
    }, 150);
    setTimeout(() => {
      createBeepSound(900, 250, 0.4, 'triangle');
    }, 300);
  };
  
  // 決勝局激活音效 - 上升的兩個音
  const playFGSound = () => {
    createBeepSound(500, 150, 0.3, 'sine');
    setTimeout(() => {
      createBeepSound(700, 250, 0.4, 'sine');
    }, 180);
  };
  
  // W獲勝音效 - 上升的三個音
  const playWinSound = () => {
    createBeepSound(500, 100, 0.3, 'sine');
    setTimeout(() => {
      createBeepSound(700, 100, 0.3, 'sine');
    }, 120);
    setTimeout(() => {
      createBeepSound(900, 200, 0.4, 'sine');
    }, 240);
  };

  // 切換音效開關
  const toggleSound = () => {
    setSoundEnabled(prev => !prev);
    
    // 切換到啟用時播放測試音效
    const wasDisabled = !soundEnabled;
    if (wasDisabled) {
      // 短暫延遲確保狀態已更新
      setTimeout(() => {
        createBeepSound(600, 80, 0.2, 'sine');
      }, 50);
    }
  };
  
  // 在組件卸載時清理 AudioContext
  useEffect(() => {
    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
    };
  }, []);

  // 返回所有音效相關功能
  return {
    soundEnabled,
    setSoundEnabled,
    toggleSound,
    audioContextRef,
    playScoreSound,
    playSwitchSound,
    playGameOverSound,
    playFGSound,
    playWinSound,
    createBeepSound
  };
};

export default useAudioEffects;
