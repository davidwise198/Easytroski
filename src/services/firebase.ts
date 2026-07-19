import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";


const firebaseConfig = {
  apiKey: "AIzaSyCMCkiB11bejVAygotP4Bk2osl7KRxl-WU",
  authDomain: "easytroski-65c46.firebaseapp.com",
  projectId: "easytroski-65c46",
  storageBucket: "easytroski-65c46.firebasestorage.app",
  messagingSenderId: "1064591962061",
  appId: "1:1064591962061:web:1f69372d71ee7306e31e84",
};


const app = initializeApp(firebaseConfig);


export const auth = getAuth(app);

export const db = getFirestore(app);