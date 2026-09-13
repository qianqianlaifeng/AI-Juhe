/* DEBUG VERSION */
(function () {
  'use strict';
  
  console.log('DEBUG: Script loaded');
  
  const AGNES_CONFIG = {
    baseURL: 'https://api.agnes-ai.cn/v1',
    apiKey: 'sk-5dxkoayGKuy09DeveyAnlYUHRUzlE6xx9j4RUKHDqcNHoFZ8',
    textModel: 'agnes-2.5-flash',
    imageModel: 'agnes-image-2.5-flash'
  };
  
  const state = {
    messages: [],
    mode: 'chat',
    isStreaming: false,
    abortCtrl: null
  };
  
  const $ = (id) => document.getElementById(id);
  
  console.log('DEBUG: $ function defined');
  console.log('DEBUG: dramaSend exists:', !!);
  console.log('DEBUG: dramaInput exists:', !!);
  console.log('DEBUG: dramaChat exists:', !!);
  
  window.DramaExpert = {
    test: function() {
      console.log('DEBUG: test() called');
      console.log('DEBUG: dramaSend button:', );
      if () {
        .style.background = 'red';
      }
    }
  };
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      console.log('DEBUG: DOMContentLoaded fired');
      window.DramaExpert && window.DramaExpert.test();
    });
  } else {
    console.log('DEBUG: DOM already ready');
    window.DramaExpert && window.DramaExpert.test();
  }
})();
