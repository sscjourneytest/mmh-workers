// firebase-config.js
const FIREBASE_PROJECTS = {
    cgl: {
        apiKey: "AIzaSyBlYDQQ-tqx57iILNP70p08dsKd03aXoO4",
        authDomain: "mmh-cgl-full-mock-data-1.firebaseapp.com",
        databaseURL: "https://mmh-cgl-full-mock-data-1-default-rtdb.firebaseio.com",
        projectId: "mmh-cgl-full-mock-data-1",
        storageBucket: "mmh-cgl-full-mock-data-1.firebasestorage.app",
        messagingSenderId: "155878036031",
        appId: "1:155878036031:web:a061644eea5c97dfaa5e8a"
    },
    chsl: {
  apiKey: "AIzaSyCekzDObGN7Gc5ENfmMejddM8PKxOob_gE",
  authDomain: "mmh-chsl-full-mock-data.firebaseapp.com",
  databaseURL: "https://mmh-chsl-full-mock-data-default-rtdb.firebaseio.com",
  projectId: "mmh-chsl-full-mock-data",
  storageBucket: "mmh-chsl-full-mock-data.firebasestorage.app",
  messagingSenderId: "672897736088",
  appId: "1:672897736088:web:ddff435bec20076ffe1fed"
},
    cpo: {
  apiKey: "AIzaSyBvDo7SiNZZNp7GYww2kYL6G6K0rHumJjU",
  authDomain: "mmh-cpo-mock-data.firebaseapp.com",
  databaseURL: "https://mmh-cpo-mock-data-default-rtdb.firebaseio.com",
  projectId: "mmh-cpo-mock-data",
  storageBucket: "mmh-cpo-mock-data.firebasestorage.app",
  messagingSenderId: "628480016731",
  appId: "1:628480016731:web:8f9255dd6181f04d15da7e"
},
mts: {
  apiKey: "AIzaSyBvDo7SiNZZNp7GYww2kYL6G6K0rHumJjU",
  authDomain: "mmh-cpo-mock-data.firebaseapp.com",
  databaseURL: "https://mmh-cpo-mock-data-default-rtdb.firebaseio.com",
  projectId: "mmh-cpo-mock-data",
  storageBucket: "mmh-cpo-mock-data.firebasestorage.app",
  messagingSenderId: "628480016731",
  appId: "1:628480016731:web:8f9255dd6181f04d15da7e"
},
    ntpc: {
  apiKey: "AIzaSyASXA4iVuYUnyZTgXK-NZWJ47mSXkNEVmc",
  authDomain: "mmh-ntpc-data.firebaseapp.com",
  databaseURL: "https://mmh-ntpc-data-default-rtdb.firebaseio.com",
  projectId: "mmh-ntpc-data",
  storageBucket: "mmh-ntpc-data.firebasestorage.app",
  messagingSenderId: "1054107557086",
  appId: "1:1054107557086:web:8286add6c37ceb0613764f"
},
imps: {
  apiKey: "AIzaSyD-oiddgo3e_yCSj_5V-hEkl1v6F_xLfps",
  authDomain: "important-series-data.firebaseapp.com",
  databaseURL: "https://important-series-data-default-rtdb.firebaseio.com",
  projectId: "important-series-data",
  storageBucket: "important-series-data.firebasestorage.app",
  messagingSenderId: "522376119353",
  appId: "1:522376119353:web:85614763392faf2f09f9e8"
},
common: {
  apiKey: "AIzaSyALO6nic0bFKa3uhM-XmgVz1GjkoLKqExs",
  authDomain: "mmh-cgl-paid-full-mock-data.firebaseapp.com",
  databaseURL: "https://mmh-cgl-paid-full-mock-data-default-rtdb.firebaseio.com",
  projectId: "mmh-cgl-paid-full-mock-data",
  storageBucket: "mmh-cgl-paid-full-mock-data.firebasestorage.app",
  messagingSenderId: "779226300897",
  appId: "1:779226300897:web:b266edaa84cafd982892a0"
},
    phase: {
  apiKey: "AIzaSyASXA4iVuYUnyZTgXK-NZWJ47mSXkNEVmc",
  authDomain: "mmh-ntpc-data.firebaseapp.com",
  databaseURL: "https://mmh-ntpc-data-default-rtdb.firebaseio.com",
  projectId: "mmh-ntpc-data",
  storageBucket: "mmh-ntpc-data.firebasestorage.app",
  messagingSenderId: "1054107557086",
  appId: "1:1054107557086:web:8286add6c37ceb0613764f"
},
    gd: {
  apiKey: "AIzaSyADjzBAITrE8WF_825Nba5NMxbLxPWA20w",
  authDomain: "ssc-gd-databse.firebaseapp.com",
  databaseURL: "https://ssc-gd-databse-default-rtdb.firebaseio.com",
  projectId: "ssc-gd-databse",
  storageBucket: "ssc-gd-databse.firebasestorage.app",
  messagingSenderId: "417110128359",
  appId: "1:417110128359:web:d96f5341c1f461e2a59442"
},
steno: {
  apiKey: "AIzaSyA6A9-97Z5bBFNCDwI4qHAQ2y7IbydO1RA",
  authDomain: "mmh-cgl-sectional-mocks-data.firebaseapp.com",
  databaseURL: "https://mmh-cgl-sectional-mocks-data-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "mmh-cgl-sectional-mocks-data",
  storageBucket: "mmh-cgl-sectional-mocks-data.firebasestorage.app",
  messagingSenderId: "557957241227",
  appId: "1:557957241227:web:21873351a0d301b6c4f78e"
},
    
"ssc-sub": {
  apiKey: "AIzaSyA6A9-97Z5bBFNCDwI4qHAQ2y7IbydO1RA",
  authDomain: "mmh-cgl-sectional-mocks-data.firebaseapp.com",
  databaseURL: "https://mmh-cgl-sectional-mocks-data-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "mmh-cgl-sectional-mocks-data",
  storageBucket: "mmh-cgl-sectional-mocks-data.firebasestorage.app",
  messagingSenderId: "557957241227",
  appId: "1:557957241227:web:21873351a0d301b6c4f78e"
},
    "ntpc-ug": {
  apiKey: "AIzaSyBQf89WRZ0UqjFraat3LJjmAtMiDK8V1-M",
  authDomain: "mmh-ntpc-ug.firebaseapp.com",
  databaseURL: "https://mmh-ntpc-ug-default-rtdb.firebaseio.com",
  projectId: "mmh-ntpc-ug",
  storageBucket: "mmh-ntpc-ug.firebasestorage.app",
  messagingSenderId: "912675733508",
  appId: "1:912675733508:web:a357b581b9c36b35557551"
}
};
