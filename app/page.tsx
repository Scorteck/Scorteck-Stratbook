"use client"
import { useState, useEffect } from "react"
import { supabase } from "./lib/supabase"
import dynamic from 'next/dynamic';
import 'react-quill/dist/quill.snow.css';
import { Session } from '@supabase/supabase-js';

// Patch de compatibilité pour React 19 et React-Quill
if (typeof window !== 'undefined') {
  (window as any).global = window;
  
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const rd = require('react-dom');
    if (rd && !rd.findDOMNode) {
      if (Object.isExtensible(rd)) {
        rd.findDOMNode = (el: any) => el;
      } else {
        // Fallback for frozen objects: set on window for react-quill to find
        (window as any).ReactDOM = { ...rd, findDOMNode: (el: any) => el };
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const r = require('react');
    (window as any).React = r;
  } catch (e) {
    console.warn("React-Quill compatibility patch failed:", e);
  }
}

// --- Types ---
interface MapData {
  id: string;
  name: string;
  image_url: string;
  callout_url?: string;
  is_active: boolean;
}

interface Composition {
  id: string;
  map_id: string;
  agents: string[];
  created_at: string;
}

interface StrategyStepContent {
  id: string;
  text: string;
}

interface StrategyStep {
  img: string;
  contents: StrategyStepContent[];
}

interface Strategy {
  id: number;
  compo_id: string;
  side: "ATK" | "DEF";
  tab_name: string;
  title: string;
  content: string;
  steps: StrategyStep[];
}

const ReactQuill = dynamic(() => import('react-quill'), { 
  ssr: false,
  loading: () => <div style={{ height: "150px", background: "#0f1923", borderRadius: "8px" }} />
});

const quillModules = {
  toolbar: [
    [{ 'size': ['small', false, 'large', 'huge'] }],
    ['bold', 'italic', 'underline'],
    [{ 'color': [] }, { 'background': [] }],
    [{ 'list': 'ordered' }, { 'list': 'bullet' }],
    ['clean']
  ],
};

const ALL_AGENTS = [
  "Astra", "Breach", "Brimstone", "Chamber", "Cypher", "Deadlock", "Fade", "Gekko", 
  "Iso", "Jett", "KAYO", "Killjoy", "Miks", "Neon", "Omen", "Phoenix", 
  "Raze", "Reyna", "Sage", "Skye", "Sova", "Tejo", "Viper", "Vyse", "Yoru"
].sort();

const AGENT_ICON_BASE_URL = "https://dsqlvperlkpdzcmjcvpj.supabase.co/storage/v1/object/public/Icon%20Agents/";
const BACKGROUND_URL = "https://dsqlvperlkpdzcmjcvpj.supabase.co/storage/v1/object/public/Image%20map/Valorant%20Background.jpg";

export default function StratBook() {
  const [view, setView] = useState<"home" | "map" | "admin">("home")
  const [activeMap, setActiveMap] = useState<MapData | null>(null)
  const [maps, setMaps] = useState<MapData[]>([])
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<Session | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [isCoachOrAdmin, setIsCoachOrAdmin] = useState(false)
  // NAVIGATION COULISSANTE (LOCKED)
  const [isNavOpen, setIsNavOpen] = useState(false);
  const [compositions, setCompositions] = useState<Composition[]>([])
  const [selectedCompo, setSelectedCompo] = useState<Composition | null>(null)
  const [selectedSide, setSelectedSide] = useState<"ATK" | "DEF" | null>(null)
  const [activeTab, setActiveTab] = useState<string | null>(null)
  const [strategies, setStrategies] = useState<Strategy[]>([])
  const [showStratModal, setShowStratModal] = useState(false)
  const [showCallouts, setShowCallouts] = useState(false)
  const [fullscreenStrat, setFullscreenStrat] = useState<Strategy | null>(null)
  const [newStrat, setNewStrat] = useState<{ id?: number; title: string; general_notes: string; steps: StrategyStep[] }>({ title: "", general_notes: "", steps: [] })
  const [authView, setAuthView] = useState<"login" | "signup">("login")
  const [authEmail, setAuthEmail] = useState("")
  const [authPassword, setAuthPassword] = useState("")
  const [authError, setAuthError] = useState<string | null>(null)
  const [isVerifyStep, setIsVerifyStep] = useState(false)
  const [allUsers, setAllUsers] = useState<any[]>([])
  const [stats, setStats] = useState({ strategies: 0, users: 0 })

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session); 
      if (session) fetchUserProfile(session.user.id);
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) fetchUserProfile(session.user.id);
      else {
        setIsAdmin(false);
        setIsCoachOrAdmin(false);
      }
    });

    fetchMaps();
    return () => subscription.unsubscribe();
  }, [])

  useEffect(() => { if (activeMap) fetchCompositions(activeMap.id) }, [activeMap])
  useEffect(() => { if (selectedCompo && selectedSide && activeTab) fetchStrategies() }, [selectedCompo, selectedSide, activeTab])
  useEffect(() => { if (view === "admin") fetchAdminData() }, [view])

  async function fetchUserProfile(userId: string) {
    const { data, error: fetchError } = await supabase.from('profiles').select('role').eq('id', userId).maybeSingle()
    if (fetchError) console.error("Error fetching profile:", fetchError)
    
    if (data) {
      setIsAdmin(data.role === 'Admin')
      setIsCoachOrAdmin(data.role === 'Admin' || data.role === 'Coach')
    } else {
      // Si le profil n'existe pas encore (nouvel utilisateur), on le crée par défaut en 'Joueur'
      const { data: newProfile, error: insertError } = await supabase.from('profiles').insert([{ id: userId, role: 'Joueur' }]).select().single()
      if (insertError) console.error("Error inserting profile:", insertError)
      if (newProfile) {
        setIsAdmin(false)
        setIsCoachOrAdmin(false)
      }
    }
  }

  async function fetchAdminData() {
    if (!isAdmin) return;
    const { data: users } = await supabase.from('profiles').select('*');
    if (users) setAllUsers(users);
    
    const { count: stratCount } = await supabase.from('strategies_v2').select('*', { count: 'exact', head: true });
    setStats({ strategies: stratCount || 0, users: users?.length || 0 });
  }

  async function updateUserRole(userId: string, newRole: string) {
    const { error } = await supabase.from('profiles').update({ role: newRole }).eq('id', userId);
    if (!error) fetchAdminData();
    else alert("Erreur lors de la mise à jour du rôle");
  }

  async function handleSocialAuth(provider: 'discord' | 'google') {
    setAuthError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: window.location.origin
      }
    });
    if (error) setAuthError(error.message);
  }

  async function handleAuth(e: React.FormEvent) {
    e.preventDefault();
    setAuthError(null);
    if (authView === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword });
      if (error) setAuthError(error.message);
    } else {
      const { error } = await supabase.auth.signUp({ email: authEmail, password: authPassword });
      if (error) setAuthError(error.message);
      else setIsVerifyStep(true);
    }
  }

  async function fetchMaps() {
    setLoading(true)
    const { data } = await supabase.from('maps').select('*').order('name', { ascending: true })
    if (data) setMaps(data)
    setLoading(false)
  }

  async function updateCalloutUrl(mapId: string) {
    const url = prompt("Collez l'URL de l'image Callout (PNG/JPG) :");
    if (url === null) return;
    const { error } = await supabase.from('maps').update({ callout_url: url }).eq('id', mapId);
    if (!error) {
        const { data } = await supabase.from('maps').select('*').eq('id', mapId).single();
        setActiveMap(data);
        fetchMaps();
    }
  }

  async function fetchCompositions(mapId: string) {
    const { data } = await supabase.from('compositions').select('*').eq('map_id', mapId).order('created_at', { ascending: false })
    if (data) setCompositions(data)
  }

  async function deleteComposition(compoId: string) {
    if (!confirm("Supprimer définitivement cette composition ?")) return;
    const { error } = await supabase.from('compositions').delete().eq('id', compoId);
    if (error) alert("Erreur lors de la suppression de la composition");
    else if (activeMap) fetchCompositions(activeMap.id);
  }

  async function fetchStrategies() {
    if (!selectedCompo || !selectedSide || !activeTab) return;
    const { data } = await supabase.from('strategies_v2').select('*')
      .eq('compo_id', selectedCompo.id).eq('side', selectedSide).eq('tab_name', activeTab)
    setStrategies(data || [])
  }

  const addStep = () => setNewStrat({ ...newStrat, steps: [...newStrat.steps, { img: "", contents: [{ id: Date.now().toString(), text: "" }] }] });
  
  const updateStep = (index: number, value: string) => {
    const updatedSteps = [...newStrat.steps];
    updatedSteps[index].img = value;
    setNewStrat({ ...newStrat, steps: updatedSteps });
  };

  const addStepContent = (stepIndex: number) => {
    const updatedSteps = [...newStrat.steps];
    updatedSteps[stepIndex].contents = [...updatedSteps[stepIndex].contents, { id: Date.now().toString(), text: "" }];
    setNewStrat({ ...newStrat, steps: updatedSteps });
  };

  const updateStepContent = (stepIndex: number, contentIndex: number, value: string) => {
    const updatedSteps = [...newStrat.steps];
    updatedSteps[stepIndex].contents[contentIndex].text = value;
    setNewStrat({ ...newStrat, steps: updatedSteps });
  };

  const removeStepContent = (stepIndex: number, contentIndex: number) => {
    const updatedSteps = [...newStrat.steps];
    updatedSteps[stepIndex].contents = updatedSteps[stepIndex].contents.filter((_, i) => i !== contentIndex);
    setNewStrat({ ...newStrat, steps: updatedSteps });
  };

  const uploadStepImage = async (file: File, index: number) => {
    if (!activeMap?.name || !selectedSide || !activeTab) {
      alert("Sélectionne une map, un side et un onglet avant l'upload.");
      return;
    }

    const normalizePathSegment = (value: string) =>
      value
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9-_]+/g, "-")
        .replace(/^-+|-+$/g, "");

    // 1. Définir le chemin de stockage unique
    const timestamp = Date.now();
    const safeTitle = normalizePathSegment(newStrat.title || "strat");
    const mapName = normalizePathSegment(activeMap.name);
    const sideName = normalizePathSegment(selectedSide);
    const tabName = normalizePathSegment(activeTab);
    const fileName = `${safeTitle}_${timestamp}_step${index + 1}.webp`;
    const storagePath = `${mapName}/${sideName}/${tabName}/${fileName}`;

    // 2. Mettre à jour l'état pour afficher "CHARGEMENT" sur l'étape
    updateStep(index, "LOADING");

    // 3. Upload technique vers Supabase Storage
    const { error } = await supabase.storage
      .from("map-strategies")
      .upload(storagePath, file, { upsert: true });

    if (error) {
      alert("Erreur lors de l'upload : " + error.message);
      updateStep(index, "");
      return;
    }

    // 4. Récupérer l'URL publique et la stocker dans l'étape
    const {
      data: { publicUrl },
    } = supabase.storage.from("map-strategies").getPublicUrl(storagePath);
    updateStep(index, publicUrl);
  };

  async function saveStrategy() {
    if (!newStrat.title) return alert("Donne un titre à ta strat !");
    if (!selectedCompo || !selectedSide || !activeTab) return;

    const payload = {
      compo_id: selectedCompo.id,
      side: selectedSide,
      tab_name: activeTab,
      title: newStrat.title,
      content: newStrat.general_notes,
      steps: newStrat.steps
    };

    let error = null;
    const isUniqueTab = activeTab === "ZONE DE JEU" || activeTab === "PRINCIPE";

    if (isUniqueTab) {
      const { data: existing, error: findError } = await supabase
        .from('strategies_v2')
        .select('id')
        .eq('compo_id', selectedCompo.id)
        .eq('side', selectedSide)
        .eq('tab_name', activeTab)
        .limit(1)
        .maybeSingle();

      if (findError) {
        error = findError;
      } else if (existing?.id) {
        const { error: updateError } = await supabase
          .from('strategies_v2')
          .update({
            title: payload.title,
            content: payload.content,
            steps: payload.steps
          })
          .eq('id', existing.id);
        error = updateError;
      } else {
        const { error: insertError } = await supabase.from('strategies_v2').insert([payload]);
        error = insertError;
      }
    } else if (newStrat.id) {
      // Modification d'une stratégie existante (hors onglets uniques)
      const { error: updateError } = await supabase
        .from('strategies_v2')
        .update({
          title: payload.title,
          content: payload.content,
          steps: payload.steps
        })
        .eq('id', newStrat.id);
      error = updateError;
    } else {
      // Insertion d'une nouvelle stratégie
      const { error: insertError } = await supabase.from('strategies_v2').insert([payload]);
      error = insertError;
    }

    if (error) {
      const e = error as any;
      alert("Erreur : " + e.message);
    } else { setShowStratModal(false); setNewStrat({ title: "", general_notes: "", steps: [] }); fetchStrategies(); }
  }

  async function deleteStrategy(id: number) {
    if (!confirm("Supprimer définitivement cette stratégie ?")) return;
    const { error } = await supabase.from('strategies_v2').delete().eq('id', id);
    if (error) alert("Erreur lors de la suppression");
    else fetchStrategies(); // Rafraîchit la liste
  }

  const getIconUrl = (agentName: string) => `${AGENT_ICON_BASE_URL}${agentName}_icon.webp`;

  if (loading) return <div style={{background: "#0f1923", color: "white", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center"}}>CHARGEMENT DU SYSTÈME...</div>

  if (!session) {
    const accentColor = authView === "login" ? "#ff4655" : "#00f2ff";
    return (
      <div style={{ backgroundColor: "#0f1923", color: "white", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", position: "relative", fontFamily: 'sans-serif' }}>
        <div style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100%", backgroundImage: `linear-gradient(rgba(15, 25, 35, 0.85), rgba(15, 25, 35, 0.98)), url(${BACKGROUND_URL})`, backgroundSize: "cover", zIndex: 0 }} />
        
        <div style={{ zIndex: 10, background: "rgba(10, 15, 20, 0.95)", padding: "40px", borderRadius: "15px", border: `2px solid ${accentColor}`, width: "400px", boxShadow: `0 0 50px ${accentColor}33`, transition: "all 0.3s ease" }}>
          <h1 style={{ color: accentColor, textAlign: "center", margin: "0 0 30px 0", fontWeight: "900", letterSpacing: "3px" }}>SCORTECK STRATBOOK</h1>
          
          <div style={{ display: "flex", marginBottom: "30px", borderBottom: "1px solid #333" }}>
            <button onClick={() => { setAuthView("login"); setIsVerifyStep(false); setAuthError(null); }} style={{ flex: 1, background: "none", border: "none", color: authView === "login" ? "#ff4655" : "#666", padding: "10px", fontWeight: "bold", cursor: "pointer", borderBottom: authView === "login" ? "2px solid #ff4655" : "none" }}>LOGIN</button>
            <button onClick={() => { setAuthView("signup"); setIsVerifyStep(false); setAuthError(null); }} style={{ flex: 1, background: "none", border: "none", color: authView === "signup" ? "#00f2ff" : "#666", padding: "10px", fontWeight: "bold", cursor: "pointer", borderBottom: authView === "signup" ? "2px solid #00f2ff" : "none" }}>SIGN UP</button>
          </div>

          {isVerifyStep ? (
            <div style={{ textAlign: "center", padding: "20px 0" }}>
              <div style={{ 
                fontSize: "3rem", 
                marginBottom: "20px", 
                animation: "pulse 2s infinite", 
                color: "#00f2ff" 
              }}>📡</div>
              
              <h2 style={{ color: "#00f2ff", fontSize: "1.2rem", fontWeight: "900", letterSpacing: "2px", marginBottom: "15px" }}>VÉRIFICATION DU PROTOCOLE</h2>
              
              <div style={{ background: "rgba(255,255,255,0.05)", padding: "15px", borderRadius: "8px", border: "1px solid rgba(0,242,255,0.2)", marginBottom: "25px" }}>
                <p style={{ fontSize: "0.85rem", lineHeight: "1.6", color: "#ccc", margin: 0 }}>
                  Transmission cryptée envoyée à <br/>
                  <span style={{ color: "#00f2ff", fontWeight: "bold" }}>{authEmail}</span>. <br/><br/>
                  Merci de valider votre identité pour déverrouiller le Stratbook.
                </p>
              </div>

              {/* Barre de Scan / Progression */}
              <div style={{ width: "100%", height: "4px", background: "#1a2531", borderRadius: "2px", marginBottom: "30px", overflow: "hidden", position: "relative" }}>
                <div style={{ 
                  position: "absolute", 
                  top: 0, 
                  left: "-100%", 
                  width: "100%", 
                  height: "100%", 
                  background: "#00f2ff", 
                  animation: "scan 1.5s infinite linear" 
                }} />
              </div>

              <button 
                onClick={() => { setIsVerifyStep(false); setAuthView("login"); }}
                style={{ background: "transparent", border: "1px solid #00f2ff", color: "#00f2ff", padding: "12px 25px", borderRadius: "4px", fontWeight: "900", cursor: "pointer", letterSpacing: "1px", width: "100%" }}
              >
                RETOUR AU LOGIN
              </button>

              <style>{`
                @keyframes scan {
                  0% { left: -100%; }
                  100% { left: 100%; }
                }
                @keyframes pulse {
                  0% { transform: scale(1); opacity: 0.8; }
                  50% { transform: scale(1.1); opacity: 1; }
                  100% { transform: scale(1); opacity: 0.8; }
                }
              `}</style>
            </div>
          ) : (
            <>
              <form onSubmit={handleAuth} style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                <div>
                  <label style={{ fontSize: "0.7rem", color: accentColor, fontWeight: "900", display: "block", marginBottom: "8px" }}>EMAIL</label>
                  <input type="email" value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} style={{ width: "100%", background: "#1a2531", border: "1px solid #333", color: "white", padding: "12px", borderRadius: "4px" }} required />
                </div>
                <div>
                  <label style={{ fontSize: "0.7rem", color: accentColor, fontWeight: "900", display: "block", marginBottom: "8px" }}>PASSWORD</label>
                  <input type="password" value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} style={{ width: "100%", background: "#1a2531", border: "1px solid #333", color: "white", padding: "12px", borderRadius: "4px" }} required />
                </div>
                
                {authError && (
                  <div style={{ color: accentColor, fontSize: "0.75rem", fontWeight: "bold", background: `${accentColor}1a`, padding: "10px", borderRadius: "4px", border: `1px solid ${accentColor}33` }}>
                    ⚠️ {authError}
                  </div>
                )}

                <button type="submit" style={{ background: accentColor, color: authView === "login" ? "white" : "#0f1923", padding: "15px", border: "none", borderRadius: "4px", fontWeight: "900", cursor: "pointer", marginTop: "10px", letterSpacing: "2px" }}>
                  {authView === "login" ? "ACCESS GRANTED" : "REQUEST ACCESS"}
                </button>
              </form>

              <div style={{ margin: "30px 0 20px 0", display: "flex", alignItems: "center", gap: "10px" }}>
                <div style={{ flex: 1, height: "1px", background: "#333" }} />
                <span style={{ color: "#666", fontSize: "0.7rem", fontWeight: "bold" }}>SOCIAL LOGIN</span>
                <div style={{ flex: 1, height: "1px", background: "#333" }} />
              </div>

              <div style={{ display: "flex", gap: "15px" }}>
                <button 
                  onClick={() => handleSocialAuth('discord')}
                  style={{ flex: 1, background: "#5865F2", color: "white", border: "none", padding: "12px", borderRadius: "4px", cursor: "pointer", fontWeight: "bold", display: "flex", alignItems: "center", justifyContent: "center", gap: "10px" }}
                >
                  DISCORD
                </button>
                <button 
                  onClick={() => handleSocialAuth('google')}
                  style={{ flex: 1, background: "white", color: "#0f1923", border: "none", padding: "12px", borderRadius: "4px", cursor: "pointer", fontWeight: "bold", display: "flex", alignItems: "center", justifyContent: "center", gap: "10px" }}
                >
                  GOOGLE
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ backgroundColor: "#0f1923", color: "white", minHeight: "100vh", position: "relative", fontFamily: 'sans-serif' }}>
      
      <div style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100%", backgroundImage: `linear-gradient(rgba(15, 25, 35, 0.85), rgba(15, 25, 35, 0.98)), url(${BACKGROUND_URL})`, backgroundSize: "cover", zIndex: 0 }} />

      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "15px 40px", borderBottom: "2px solid #ff4655", position: "fixed", top: 0, left: 0, width: "100%", zIndex: 1000, background: "rgba(10, 15, 20, 0.95)" }}>
        <h1 style={{ color: "#ff4655", margin: 0, fontWeight: "900", cursor: "pointer", fontSize: "1.4rem", letterSpacing: "2px" }} onClick={() => setView("home")}>SCORTECK STRATBOOK</h1>
        {session && <button onClick={() => supabase.auth.signOut()} style={{background: "#ff4655", border: "none", color: "white", padding: "8px 15px", borderRadius: "4px", cursor: "pointer", fontWeight: "bold"}}>LOGOUT</button>}
      </header>

      {/* NAVIGATION COULISSANTE (SANS BARRE DE SCROLL) */}
      <div 
        onMouseEnter={() => setIsNavOpen(true)}
        onMouseLeave={() => setIsNavOpen(false)}
        style={{ 
          position: "fixed", top: "71px", left: 0, bottom: 0, 
          width: isNavOpen ? "250px" : "30px", // Zone de détection élargie à 30px au lieu de 15px
          background: isNavOpen ? "rgba(10, 15, 20, 0.98)" : "transparent", // Transparent quand fermé
          zIndex: 2000, 
          transition: "width 0.3s cubic-bezier(0.4, 0, 0.2, 1), background 0.3s ease", 
          borderRight: isNavOpen ? "3px solid #ff4655" : "none", 
          padding: isNavOpen ? "20px" : "0", 
          overflow: isNavOpen ? "auto" : "visible",
          msOverflowStyle: "none",
          scrollbarWidth: "none",
          pointerEvents: "auto"
        }}
        className="nav-no-scrollbar"
      >
        {/* LANGUETTE 'MAP' (Toujours là mais s'efface quand ouvert) */}
        <div style={{
          position: "absolute",
          top: "50%",
          left: isNavOpen ? "-50px" : "0", // On la cache à gauche quand c'est ouvert
          transform: "translateY(-50%)",
          width: "25px", // Un peu plus large pour être plus facile à attraper
          height: "120px",
          background: "#ff4655",
          borderRadius: "0 8px 8px 0",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "white",
          fontWeight: "900",
          fontSize: "0.85rem",
          writingMode: "vertical-rl",
          textOrientation: "upright",
          letterSpacing: "3px",
          boxShadow: "5px 0 15px rgba(255, 70, 85, 0.4)",
          transition: "all 0.3s ease",
          opacity: isNavOpen ? 0 : 1,
          pointerEvents: isNavOpen ? "none" : "auto"
        }}>
          MAP
        </div>
        {/* CSS Inline pour masquer le scrollbar sur Chrome/Safari */}
        <style>{`
          .nav-no-scrollbar::-webkit-scrollbar { display: none; }
        `}</style>
        {isNavOpen && (
          <>
            <p style={{ fontSize: "0.8rem", fontWeight: "900", color: "#ff4655", marginBottom: "20px", textAlign: "center", letterSpacing: "2px" }}>MENU TACTIQUE</p>
            {["POOL ACTUEL", "HORS POOL"].map((cat) => (
              <div key={cat} style={{ marginBottom: "30px" }}>
                <p style={{ fontSize: "0.65rem", color: cat === "POOL ACTUEL" ? "#ff4655" : "#666", fontWeight: "900", marginBottom: "12px", letterSpacing: "1px", borderBottom: "1px solid rgba(255,255,255,0.05)", paddingBottom: "5px" }}>
                  {cat}
                </p>
                {maps.filter(m => cat === "POOL ACTUEL" ? m.is_active : !m.is_active).map(m => ( 
                  <div 
                    key={m.id} 
                    onClick={() => { setActiveMap(m); setView("map"); setIsNavOpen(false); }} 
                    style={{ 
                      cursor: "pointer", 
                      marginBottom: "12px", 
                      borderRadius: "8px", 
                      overflow: "hidden", 
                      border: activeMap?.id === m.id ? "2px solid #ff4655" : "1px solid rgba(255,255,255,0.1)", 
                      opacity: m.is_active ? 1 : 0.6, 
                      transition: "all 0.2s ease", 
                      transform: "translateX(0)" 
                    }} 
                    onMouseEnter={e => { 
                      e.currentTarget.style.borderColor = "#ff4655"; 
                      e.currentTarget.style.background = "rgba(255, 70, 85, 0.1)"; 
                      e.currentTarget.style.transform = "translateX(5px)"; 
                    }} 
                    onMouseLeave={e => { 
                      e.currentTarget.style.borderColor = activeMap?.id === m.id ? "#ff4655" : "rgba(255,255,255,0.1)"; 
                      e.currentTarget.style.background = "transparent"; 
                      e.currentTarget.style.transform = "translateX(0)"; 
                    }} 
                  > 
                    <img src={m.image_url} style={{ width: "100%", height: "50px", objectFit: "cover", filter: m.is_active ? "none" : "grayscale(1)" }} /> 
                    <div style={{ textAlign: "center", fontSize: "0.7rem", padding: "6px", fontWeight: "900", background: "rgba(0,0,0,0.5)" }}> 
                      {m.name.toUpperCase()} 
                    </div> 
                  </div> 
                ))} 
              </div>
            ))}

            {isAdmin && (
              <div 
                onClick={() => { setView("admin"); setIsNavOpen(false); }}
                style={{ 
                  marginTop: "20px", padding: "15px", background: view === "admin" ? "rgba(255,70,85,0.2)" : "rgba(255,255,255,0.05)", 
                  border: "1px solid " + (view === "admin" ? "#ff4655" : "#333"), borderRadius: "8px", cursor: "pointer", 
                  textAlign: "center", transition: "0.2s" 
                }}
                onMouseEnter={e => e.currentTarget.style.borderColor = "#ff4655"}
                onMouseLeave={e => e.currentTarget.style.borderColor = view === "admin" ? "#ff4655" : "#333"}
              >
                <p style={{ fontSize: "0.7rem", fontWeight: "900", color: "#ff4655", margin: 0, letterSpacing: "1px" }}>⚙️ ADMINISTRATION</p>
              </div>
            )}
          </>
        )}
      </div>

      <div style={{ zIndex: 10, position: "relative", marginTop: "100px", padding: "0 40px" }}>
        
        {/* ACCUEIL (LOCKED) */}
        {view === "home" && (
          <div style={{ maxWidth: "1300px", margin: "0 auto" }}>
            <h2 style={{ color: "#ff4655", borderLeft: "4px solid #ff4655", paddingLeft: "15px", marginBottom: "30px", fontSize: "1.1rem" }}>
              MAP POOL ACTUEL
            </h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "30px", marginBottom: "60px" }}> 
              {maps.filter(m => m.is_active).map(map => ( 
                <div 
                  key={map.id} 
                  onClick={() => { setActiveMap(map); setView("map"); }} 
                  style={{ 
                    position: "relative", 
                    borderRadius: "15px", 
                    overflow: "hidden", 
                    cursor: "pointer", 
                    border: "2px solid rgba(255,70,85,0.2)", 
                    transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)", 
                  }} 
                  onMouseEnter={e => { 
                    e.currentTarget.style.transform = "scale(1.03) translateY(-5px)"; 
                    e.currentTarget.style.borderColor = "#ff4655"; 
                    e.currentTarget.style.boxShadow = "0 10px 30px rgba(255, 70, 85, 0.3)"; 
                  }} 
                  onMouseLeave={e => { 
                    e.currentTarget.style.transform = "scale(1) translateY(0)"; 
                    e.currentTarget.style.borderColor = "rgba(255,70,85,0.2)"; 
                    e.currentTarget.style.boxShadow = "none"; 
                  }} 
                > 
                  <img 
                    src={map.image_url} 
                    style={{ width: "100%", height: "160px", objectFit: "cover" }} 
                  /> 
                  <div 
                    style={{ 
                      position: "absolute", 
                      bottom: 0, 
                      width: "100%", 
                      background: "rgba(0,0,0,0.85)", 
                      padding: "15px", 
                      textAlign: "center", 
                      fontWeight: "bold", 
                      letterSpacing: "2px" 
                    }} 
                  > 
                    {map.name.toUpperCase()} 
                  </div> 
                </div> 
              ))} 
            </div> 

            <h2 style={{ color: "#555", borderLeft: "4px solid #333", paddingLeft: "15px", marginBottom: "30px", fontSize: "1rem" }}>
              HORS MAP POOL
            </h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "25px", opacity: 0.6 }}>
              {maps.filter(m => !m.is_active).map(map => (
                <div
                  key={map.id}
                  onClick={() => { setActiveMap(map); setView("map"); }}
                  style={{
                    position: "relative",
                    borderRadius: "10px",
                    overflow: "hidden",
                    cursor: "pointer",
                    border: "1px solid #222",
                    filter: "grayscale(100%)"
                  }}
                >
                  <img
                    src={map.image_url}
                    style={{ width: "100%", height: "120px", objectFit: "cover" }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      bottom: 0,
                      width: "100%",
                      background: "rgba(0,0,0,0.8)",
                      padding: "10px",
                      textAlign: "center",
                      fontSize: "0.8rem"
                    }}
                  >
                    {map.name.toUpperCase()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* VUE ADMINISTRATION */}
        {view === "admin" && isAdmin && (
          <div style={{ maxWidth: "1300px", margin: "0 auto" }}>
            <h2 style={{ color: "#ff4655", borderLeft: "4px solid #ff4655", paddingLeft: "15px", marginBottom: "40px", fontSize: "1.5rem", fontWeight: "900", letterSpacing: "2px" }}>
              PANNEAU D'ADMINISTRATION
            </h2>

            {/* STATISTIQUES */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px", marginBottom: "40px" }}>
              <div style={{ background: "rgba(255,255,255,0.03)", padding: "30px", borderRadius: "15px", border: "1px solid #333", textAlign: "center" }}>
                <p style={{ color: "#ff4655", fontSize: "2rem", fontWeight: "900", margin: 0 }}>{stats.users}</p>
                <p style={{ color: "#666", fontSize: "0.8rem", fontWeight: "bold", letterSpacing: "1px" }}>UTILISATEURS INSCRITS</p>
              </div>
              <div style={{ background: "rgba(255,255,255,0.03)", padding: "30px", borderRadius: "15px", border: "1px solid #333", textAlign: "center" }}>
                <p style={{ color: "#ff4655", fontSize: "2rem", fontWeight: "900", margin: 0 }}>{stats.strategies}</p>
                <p style={{ color: "#666", fontSize: "0.8rem", fontWeight: "bold", letterSpacing: "1px" }}>STRATÉGIES CRÉÉES</p>
              </div>
              <div style={{ background: "rgba(255,255,255,0.03)", padding: "30px", borderRadius: "15px", border: "1px solid #333", textAlign: "center" }}>
                <p style={{ color: "#ff4655", fontSize: "2rem", fontWeight: "900", margin: 0 }}>0</p>
                <p style={{ color: "#666", fontSize: "0.8rem", fontWeight: "bold", letterSpacing: "1px" }}>LOGS D'AUDIT</p>
              </div>
            </div>

            {/* GESTION UTILISATEURS */}
            <div style={{ background: "rgba(255,255,255,0.02)", borderRadius: "15px", border: "1px solid #333", overflow: "hidden" }}>
              <div style={{ padding: "20px", background: "rgba(255,255,255,0.05)", borderBottom: "1px solid #333" }}>
                <h3 style={{ margin: 0, fontSize: "1rem", color: "#ff4655", fontWeight: "900" }}>GESTION DES ACCÈS</h3>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left", background: "rgba(0,0,0,0.2)" }}>
                    <th style={{ padding: "15px 20px", color: "#666", fontSize: "0.8rem" }}>EMAIL</th>
                    <th style={{ padding: "15px 20px", color: "#666", fontSize: "0.8rem" }}>RÔLE ACTUEL</th>
                    <th style={{ padding: "15px 20px", color: "#666", fontSize: "0.8rem" }}>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {allUsers.map((u) => (
                    <tr key={u.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                      <td style={{ padding: "15px 20px", fontSize: "0.9rem" }}>{u.id.substring(0, 8)}... (UUID)</td>
                      <td style={{ padding: "15px 20px" }}>
                        <span style={{ 
                          background: u.role === 'Admin' ? "rgba(255,70,85,0.2)" : u.role === 'Coach' ? "rgba(78, 168, 222, 0.2)" : "rgba(255,255,255,0.1)",
                          color: u.role === 'Admin' ? "#ff4655" : u.role === 'Coach' ? "#4ea8de" : "#aaa",
                          padding: "4px 10px", borderRadius: "4px", fontSize: "0.7rem", fontWeight: "bold"
                        }}>{u.role.toUpperCase()}</span>
                      </td>
                      <td style={{ padding: "15px 20px" }}>
                        <select 
                          value={u.role} 
                          onChange={(e) => updateUserRole(u.id, e.target.value)}
                          style={{ background: "#1a2531", border: "1px solid #333", color: "white", padding: "5px 10px", borderRadius: "4px", fontSize: "0.8rem" }}
                        >
                          <option value="Joueur">JOUEUR</option>
                          <option value="Coach">COACH</option>
                          <option value="Admin">ADMIN</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {view === "map" && activeMap && (
          <div style={{ display: "flex", gap: "40px" }}>
            <div style={{ flex: 1 }}>
              <h2 style={{ color: "#ff4655", fontSize: "2rem", fontWeight: "900", marginBottom: "20px" }}>{activeMap.name.toUpperCase()}</h2>
              <div style={{ position: "relative", borderRadius: "15px", border: "3px solid #ff4655", overflow: "hidden" }}>
                <img src={activeMap.image_url} style={{ width: "100%", display: "block" }} />
                {/* FENÊTRE FLOTTANTE CALLOUT */}
                {/* FENÊTRE CENTRÉE TRANSLUCIDE - CALLOUT (OPTIMISATION INTÉGRATION) */}
                <div 
                  onClick={() => setShowCallouts(true)}
                  style={{ 
                      position: "absolute", 
                      top: "50%", 
                      left: "50%", 
                      transform: "translate(-50%, -50%)", 
                      width: "75%", // Agrandissement léger de la fenêtre
                      aspectRatio: "16/10", 
                      cursor: "zoom-in",
                      zIndex: 10,
                      transition: "0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                      borderRadius: "12px",
                      border: "2px solid rgba(255, 70, 85, 0.7)", 
                      background: "rgba(15, 25, 35, 0.8)", // Légèrement moins translucide pour le contraste
                      backdropFilter: "blur(10px)", // Flou plus intense
                      boxShadow: "0 40px 120px rgba(0,0,0,0.9)",
                      display: "flex",
                      flexDirection: "column",
                      overflow: "hidden"
                  }}
                  onMouseEnter={e => e.currentTarget.style.transform = "translate(-50%, -55%) scale(1.02)"}
                  onMouseLeave={e => e.currentTarget.style.transform = "translate(-50%, -50%) scale(1)"}
                >
                  {/* Barre de titre tactique */}
                  <div style={{ 
                      background: "rgba(255, 70, 85, 0.95)", 
                      color: "white", 
                      padding: "10px 25px", // Plus d'espace
                      display: "flex", 
                      justifyContent: "flex-start",
                      alignItems: "center",
                      fontSize: "0.9rem",
                      fontWeight: "900",
                      letterSpacing: "4px",
                      borderBottom: "2px solid rgba(0,0,0,0.4)"
                  }}>
                      <span>CALL OUT</span>
                  </div>

                  {/* Zone d'image (Intégration optimisée) */}
                  <div style={{ 
                      flex: 1, 
                      display: "flex", 
                      alignItems: "center", 
                      justifyContent: "center", 
                      padding: "10px", // Réduction drastique du padding pour un blueprint plus grand
                      background: "transparent",
                      overflow: "hidden" 
                  }}>
                      {activeMap.callout_url ? (
                        <img 
                          src={activeMap.callout_url} 
                          style={{ 
                              maxWidth: "100%", 
                              maxHeight: "100%", 
                              objectFit: "contain", // Remplir l'espace sans déformer
                              borderRadius: "6px",
                              opacity: 0.95, // Moins translucide pour la clarté
                              boxShadow: "0 5px 20px rgba(0,0,0,0.4)"
                          }} 
                          alt="tactical blueprint"
                        />
                      ) : (
                        <div style={{ color: "rgba(255,255,255,0.2)", fontSize: "0.9rem", fontWeight: "900", textAlign: "center", letterSpacing: "2px" }}>
                          DATA ENCRYPTED <br/> NO BLUEPRINT FOUND
                        </div>
                      )}
                  </div>
                </div>
              </div>
              {isAdmin && <button onClick={() => updateCalloutUrl(activeMap.id)} style={{ marginTop: "10px", width: "100%", background: "#1a2531", color: "white", border: "1px solid #ff4655", padding: "10px", borderRadius: "8px", cursor: "pointer" }}>⚙️ MODIFIER CALLOUT</button>}
            </div>

            <div style={{ flex: 2 }}>
              <p style={{ color: "#ff4655", fontSize: "0.8rem", fontWeight: "900", marginBottom: "15px", letterSpacing: "1px" }}>1. CHOISIR LA COMPO</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "15px", marginBottom: "40px" }}>
                {compositions.map(c => {
                  const isSelected = selectedCompo?.id === c.id;
                  return (
                    <div key={c.id} style={{ position: "relative" }}>
                      <div
                        onClick={() => {
                          // Si déjà sélectionné, on déselectionne tout
                          if (isSelected) {
                            setSelectedCompo(null); setSelectedSide(null); setActiveTab(null);
                          } else {
                            setSelectedCompo(c); setSelectedSide(null); setActiveTab(null);
                          }
                        }}
                        style={{
                          padding: "10px",
                          background: isSelected ? "rgba(255, 70, 85, 0.2)" : "rgba(255,255,255,0.03)",
                          borderRadius: "12px",
                          cursor: "pointer",
                          display: "flex",
                          gap: "8px",
                          border: "2px solid " + (isSelected ? "#ff4655" : "#333"),
                          transform: isSelected ? "scale(1.15)" : "scale(1)",
                          transition: "0.2s cubic-bezier(0.4, 0, 0.2, 1)",
                          zIndex: isSelected ? 10 : 1,
                          boxShadow: isSelected ? "0 10px 20px rgba(0,0,0,0.4)" : "none"
                        }}
                      >
                        {c.agents.map(a => (
                          <img key={a} src={getIconUrl(a)} style={{ width: "35px", borderRadius: "4px" }} />
                        ))}
                      </div>
                      {isAdmin && (
                        <button
                          onClick={e => { e.stopPropagation(); deleteComposition(c.id); }}
                          style={{
                            position: "absolute",
                            top: "-8px",
                            right: "-8px",
                            background: "#ff4655",
                            color: "white",
                            borderRadius: "50%",
                            width: "20px",
                            height: "20px",
                            border: "2px solid #0f1923",
                            cursor: "pointer",
                            fontSize: "10px",
                            fontWeight: "bold",
                            zIndex: 15
                          }}
                        >✕</button>
                      )}
                    </div>
                  );
                })}
              </div>

              {selectedCompo && (
                <>
                  <p style={{ color: "#ff4655", fontSize: "0.8rem", fontWeight: "900", marginBottom: "15px", letterSpacing: "1px" }}>2. SÉLECTIONNER LE CÔTÉ</p>
                  <div style={{ display: "flex", gap: "20px", marginBottom: "30px" }}>
                    {/* BOUTON ATTAQUE */}
                    <button 
                      onClick={() => {setSelectedSide("ATK"); setActiveTab(null);}} 
                      style={{ 
                        flex: 1, padding: "20px", borderRadius: "12px", cursor: "pointer", fontWeight: "900", fontSize: "1.2rem",
                        display: "flex", alignItems: "center", justifyContent: "center", gap: "15px", transition: "0.3s",
                        border: "2px solid " + (selectedSide === "ATK" ? "#ff4655" : "#333"),
                        background: selectedSide === "ATK" ? "#ff4655" : "rgba(255, 70, 85, 0.05)",
                        color: selectedSide === "ATK" ? "white" : "#ff4655",
                        boxShadow: selectedSide === "ATK" ? "0 0 20px rgba(255, 70, 85, 0.4)" : "none"
                      }}
                    >
                      <span>⚔️</span> ATTAQUE
                    </button>

                    {/* BOUTON DÉFENSE */}
                    <button 
                      onClick={() => {setSelectedSide("DEF"); setActiveTab(null);}} 
                      style={{ 
                        flex: 1, padding: "20px", borderRadius: "12px", cursor: "pointer", fontWeight: "900", fontSize: "1.2rem",
                        display: "flex", alignItems: "center", justifyContent: "center", gap: "15px", transition: "0.3s",
                        border: "2px solid " + (selectedSide === "DEF" ? "#4ea8de" : "#333"),
                        background: selectedSide === "DEF" ? "#4ea8de" : "rgba(78, 168, 222, 0.05)",
                        color: selectedSide === "DEF" ? "white" : "#4ea8de",
                        boxShadow: selectedSide === "DEF" ? "0 0 20px rgba(78, 168, 222, 0.4)" : "none"
                      }}
                    >
                      <span>🛡️</span> DÉFENSE
                    </button>
                  </div>
                  {selectedSide && (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px" }}>
                      {["ZONE DE JEU", "PRINCIPE", "EXEC/RETAKE", "PLAN DE JEU"].map(tab => <button key={tab} onClick={() => setActiveTab(tab)} style={{ padding: "12px", background: activeTab === tab ? "rgba(255,70,85,0.2)" : "transparent", border: "2px solid " + (activeTab === tab ? "#ff4655" : "#333"), color: "white", cursor: "pointer", fontWeight: "bold", borderRadius: "8px", fontSize:"0.7rem" }}>{tab}</button>)}
                    </div>
                  )}
                  {activeTab && (
                    <div style={{ marginTop: "30px", background: "rgba(0,0,0,0.4)", padding: "20px", borderRadius: "15px" }}>
                      {/* RENDU DES STRATÉGIES OU DU CONTENU UNIQUE */}
                      <div style={{ marginTop: "20px" }}>
                        {activeTab === "ZONE DE JEU" || activeTab === "PRINCIPE" ? (
                          /* VERSION PAGE UNIQUE (WIKI) */
                          <div style={{ background: "rgba(255,255,255,0.02)", borderRadius: "20px", padding: "40px", border: "1px solid rgba(255,70,85,0.1)" }}>
                            {strategies.length > 0 ? (
                              <>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "40px" }}>
                                  <h1 style={{ color: "white", fontSize: "2.5rem", fontWeight: "900", margin: 0, textTransform: "uppercase" }}>{strategies[0].title}</h1>
                                  {isCoachOrAdmin && (
                                    <button 
                                      onClick={() => { setNewStrat({ title: strategies[0].title || "", general_notes: strategies[0].content || "", steps: strategies[0].steps || [] }); setShowStratModal(true); }} 
                                      style={{ background: "#ff4655", color: "white", border: "none", padding: "10px 20px", borderRadius: "8px", cursor: "pointer", fontWeight: "bold" }}
                                    >
                                      MODIFIER LA PAGE
                                    </button>
                                  )}
                                </div>
                                
                                <div className="ql-snow" style={{ marginBottom: "50px", maxWidth: "800px" }}>
                                  <div 
                                    className="ql-editor" 
                                    style={{ padding: 0, color: "#ccc", fontSize: "1.1rem", lineHeight: "1.6" }} 
                                    dangerouslySetInnerHTML={{ __html: strategies[0].content }} 
                                  />
                                </div>
                                
                                <div style={{ display: "flex", flexDirection: "column", gap: "60px" }}>
                                  {strategies[0].steps?.map((step, idx) => (
                                    <div key={idx} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "40px", alignItems: "center" }}>
                                      <img src={step.img} style={{ width: "100%", borderRadius: "12px", border: "1px solid #333", boxShadow: "0 10px 30px rgba(0,0,0,0.5)" }} />
                                      <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                                        {(step.contents || (step.text ? [{ id: 'legacy', text: step.text }] : [])).map((content: any, j: number) => (
                                          <div 
                                            key={content.id || j}
                                            style={{ 
                                              color: "white", 
                                              fontSize: "1.1rem", 
                                              lineHeight: "1.7", 
                                              padding: "20px",
                                              background: "rgba(255,255,255,0.02)",
                                              borderLeft: "4px solid #ff4655"
                                            }}
                                            dangerouslySetInnerHTML={{ __html: content.text }} 
                                          />
                                        ))}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </>
                            ) : (
                              <div style={{ textAlign: "center", padding: "100px 0" }}>
                                <p style={{ color: "#666", marginBottom: "20px" }}>Aucun contenu n'a été créé pour cette section.</p>
                                {isCoachOrAdmin && (
                                    <button onClick={() => { setNewStrat({ title: "", general_notes: "", steps: [] }); setShowStratModal(true); }} style={{ background: "#ff4655", color: "white", border: "none", padding: "15px 30px", borderRadius: "8px", cursor: "pointer", fontWeight: "bold" }}>
                                      CRÉER LE CONTENU INITIAL
                                    </button>
                                  )}
                              </div>
                            )}
                          </div>
                        ) : (
                          /* VERSION LISTE DE STRATÉGIES CLASSIQUE (GRILLE) */
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "20px" }}>
                            {strategies.map(s => (
                              <div key={s.id} onClick={() => setFullscreenStrat(s)} style={{ padding: "25px", background: "#1a2531", borderRadius: "15px", border: "1px solid #333", cursor: "pointer", position: "relative", transition: "0.2s" }} onMouseEnter={e => e.currentTarget.style.borderColor = "#ff4655"} onMouseLeave={e => e.currentTarget.style.borderColor = "#333"}>
                                <h4 style={{ margin: 0, color: "#ff4655", fontSize: "1rem", textTransform: "uppercase", fontWeight: "900" }}>{s.title}</h4>
                                <p style={{ fontSize: "0.8rem", color: "#888", marginTop: "10px" }}>{s.steps?.length || 0} ÉTAPES DISPONIBLES</p>
                                {isCoachOrAdmin && (
                                  <div style={{ position: "absolute", top: "15px", right: "15px", display: "flex", gap: "10px" }}>
                                    <button 
                                      onClick={(e) => { 
                                        e.stopPropagation(); 
                                        setNewStrat({ id: s.id, title: s.title, general_notes: s.content, steps: s.steps }); 
                                        setShowStratModal(true); 
                                      }} 
                                      style={{ background: "transparent", border: "none", color: "#444", cursor: "pointer", fontSize: "1rem" }} 
                                      onMouseEnter={e => e.currentTarget.style.color = "#ff4655"} 
                                      onMouseLeave={e => e.currentTarget.style.color = "#444"}
                                      title="Éditer"
                                    >
                                      ✏️
                                    </button>
                                    <button 
                                      onClick={(e) => { e.stopPropagation(); deleteStrategy(s.id); }} 
                                      style={{ background: "transparent", border: "none", color: "#444", cursor: "pointer", fontSize: "1.1rem" }} 
                                      onMouseEnter={e => e.currentTarget.style.color = "#ff4655"} 
                                      onMouseLeave={e => e.currentTarget.style.color = "#444"}
                                      title="Supprimer"
                                    >
                                      🗑️
                                    </button>
                                  </div>
                                )}
                              </div>
                            ))}
                            {isCoachOrAdmin && (
                              <div onClick={() => { setNewStrat({ title: "", general_notes: "", steps: [] }); setShowStratModal(true); }} style={{ padding: "25px", background: "transparent", borderRadius: "15px", border: "2px dashed #333", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#444", fontWeight: "bold", transition: "0.2s" }} onMouseEnter={e => { e.currentTarget.style.borderColor = "#ff4655"; e.currentTarget.style.color = "#ff4655"; }} onMouseLeave={e => { e.currentTarget.style.borderColor = "#333"; e.currentTarget.style.color = "#444"; }}>
                                + NOUVELLE STRATÉGIE
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* MODAL CRÉATION STRATÉGIE (85%) */}
      {/* MODAL CRÉATION STRATÉGIE (85%) */}

      {showStratModal && isCoachOrAdmin && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.95)", zIndex: 8000, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(10px)" }}>
          <div style={{ background: "#0f1923", padding: "40px", borderRadius: "24px", border: "2px solid #ff4655", width: "85%", height: "90%", display: "flex", flexDirection: "column", boxShadow: "0 0 50px rgba(255,70,85,0.2)" }}>
            
            {/* Header Modal */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "30px", borderBottom: "1px solid #2a3541", paddingBottom: "20px" }}>
              <div>
                <h2 style={{ color: "#ff4655", margin: 0, fontSize: "1.8rem", fontWeight: "900" }}>
                  {activeTab === "ZONE DE JEU" || activeTab === "PRINCIPE" ? `ÉDITER ${activeTab}` : "NOUVELLE STRATÉGIE"}
                </h2>
                <p style={{ color: "#666", margin: "5px 0 0 0", fontSize: "0.8rem" }}>CONFIG : {selectedSide} | {activeMap?.name.toUpperCase()}</p>
              </div>
              <button onClick={() => setShowStratModal(false)} style={{ background: "transparent", border: "1px solid #ff4655", color: "#ff4655", padding: "10px 20px", borderRadius: "8px", cursor: "pointer", fontWeight: "bold" }}>ANNULER</button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1.5fr", gap: "40px", flex: 1, overflow: "hidden" }}>
              
              {/* COLONNE GAUCHE : INFOS */}
              <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                <div style={{ background: "rgba(255,255,255,0.03)", padding: "20px", borderRadius: "15px" }}>
                  <label style={{ color: "#ff4655", fontSize: "0.7rem", fontWeight: "900", display: "block", marginBottom: "10px" }}>TITRE DE LA SÉQUENCE</label>
                  <input 
                    type="text" 
                    placeholder="Ex: Prise de contrôle A" 
                    value={newStrat.title} 
                    onChange={(e) => setNewStrat({...newStrat, title: e.target.value})} 
                    style={{ width: "100%", background: "#1a2531", border: "1px solid #333", color: "white", padding: "15px", borderRadius: "8px" }} 
                  />
                </div>

                <div style={{ background: "rgba(255,255,255,0.03)", padding: "20px", borderRadius: "15px", flex: 1, display: "flex", flexDirection: "column" }}> 
                  <label style={{ color: "#ff4655", fontSize: "0.7rem", fontWeight: "900", display: "block", marginBottom: "10px" }}>NOTES D'INTENTION (PRINCIPES)</label> 
                  <div style={{ flex: 1, background: "#0f1923", borderRadius: "8px", overflow: "hidden", border: "1px solid #444" }}> 
                    <ReactQuill 
                      theme="snow" 
                      modules={quillModules} 
                      value={newStrat.general_notes || ""} 
                      onChange={(content) => setNewStrat({...newStrat, general_notes: content})} 
                      style={{ height: "250px", color: "white" }} 
                    /> 
                  </div> 
                </div>

                <button onClick={saveStrategy} style={{ width: "100%", background: "#ff4655", color: "white", padding: "20px", borderRadius: "12px", fontWeight: "900", cursor: "pointer", fontSize: "1rem", boxShadow: "0 10px 20px rgba(255,70,85,0.2)" }}>
                  ENREGISTRER LA CONFIGURATION
                </button>
              </div>

              {/* COLONNE DROITE : ÉTAPES (SCROLLABLE) */}
              <div style={{ display: "flex", flexDirection: "column", gap: "15px", overflowY: "auto", paddingRight: "10px" }} className="nav-no-scrollbar">
                <button onClick={addStep} style={{ width: "100%", background: "rgba(255,70,85,0.1)", color: "#ff4655", border: "1px dashed #ff4655", padding: "15px", borderRadius: "12px", cursor: "pointer", fontWeight: "bold" }}>
                  + AJOUTER UNE ÉTAPE VISUELLE
                </button>
                
                {newStrat.steps.map((step, i) => (
                  <div key={i} style={{ 
                    background: "#1a2531", 
                    padding: "20px", 
                    borderRadius: "12px", 
                    border: "1px solid #333", 
                    display: "flex", 
                    flexDirection: "column",
                    gap: "15px", 
                    position: "relative" 
                  }}>
                    {/* LIGNE HORIZONTALE : IMAGE + TEXTES */}
                    <div style={{ display: "flex", gap: "20px", alignItems: "flex-start" }}>
                      {/* VIGNETTE D'UPLOAD */}
                      <div style={{ 
                          position: "relative", 
                          minWidth: "250px", 
                          height: "160px", 
                          background: "#0f1923", 
                          borderRadius: "8px", 
                          overflow: "hidden", 
                          border: "2px dashed " + (step.img ? "#ff4655" : "#444"), 
                          display: "flex", 
                          alignItems: "center", 
                          justifyContent: "center",
                          cursor: "pointer",
                          transition: "0.2s"
                      }}
                      onMouseEnter={e => e.currentTarget.style.border = "2px solid #ff4655"}
                      onMouseLeave={e => e.currentTarget.style.border = "2px dashed " + (step.img ? "#ff4655" : "#444")}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const dropped = e.dataTransfer.files?.[0];
                        if (dropped) uploadStepImage(dropped, i);
                      }}
                      >
                        {step.img === "LOADING" ? (
                          <div style={{ color: "#ff4655", fontSize: "0.7rem", fontWeight: "900", animation: "pulse 1.5s infinite" }}>CHARGEMENT...</div>
                        ) : step.img ? (
                          <img src={step.img} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        ) : (
                          <div style={{ textAlign: "center", color: "#666", fontSize: "0.6rem", fontWeight: "900", letterSpacing: "1px" }}>
                            <span style={{ fontSize: "1.5rem" }}>+</span><br/>CLIQUE OU GLISSE L'IMAGE
                          </div>
                        )}
                        
                        <input 
                          type="file" 
                          accept="image/*" 
                          onChange={(e) => { if (e.target.files?.[0]) uploadStepImage(e.target.files[0], i); }} 
                          style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer" }} 
                        />
                      </div>

                      {/* LISTE DES TEXTES / CHOIX */}
                      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "20px" }}>
                        {step.contents?.map((content, j) => (
                          <div key={content.id} style={{ position: "relative", background: "#0f1923", borderRadius: "8px", overflow: "hidden", border: "1px solid #444", padding: "10px" }}>
                            <label style={{ color: "#ff4655", fontSize: "0.6rem", fontWeight: "900", display: "block", marginBottom: "8px" }}>PARAGRAPHE / CHOIX {j + 1}</label>
                            <ReactQuill 
                              theme="snow"
                              modules={quillModules}
                              value={content.text || ""} 
                              onChange={(val) => updateStepContent(i, j, val)}
                              style={{ height: "120px", color: "white" }}
                            />
                            {step.contents.length > 1 && (
                              <button 
                                onClick={() => removeStepContent(i, j)} 
                                style={{ position: "absolute", top: "8px", right: "10px", color: "#666", background: "none", border: "none", cursor: "pointer", fontSize: "0.9rem" }}
                                onMouseEnter={e => e.currentTarget.style.color = "#ff4655"}
                                onMouseLeave={e => e.currentTarget.style.color = "#666"}
                              >
                                🗑️
                              </button>
                            )}
                          </div>
                        ))}
                        
                        <button 
                          onClick={() => addStepContent(i)} 
                          style={{ width: "fit-content", background: "rgba(255,70,85,0.05)", color: "#ff4655", border: "1px dashed #ff4655", padding: "10px 20px", borderRadius: "8px", cursor: "pointer", fontSize: "0.75rem", fontWeight: "bold", transition: "0.2s" }}
                          onMouseEnter={e => e.currentTarget.style.background = "rgba(255,70,85,0.15)"}
                          onMouseLeave={e => e.currentTarget.style.background = "rgba(255,70,85,0.05)"}
                        >
                          + AJOUTER UN PARAGRAPHE / CHOIX
                        </button>
                      </div>
                    </div>

                    <style>{`
                      .ql-toolbar.ql-snow { background: #1a2531; border: none; border-bottom: 1px solid #444; }
                      .ql-snow .ql-stroke { stroke: #ccc !important; }
                      .ql-snow .ql-fill { fill: #ccc !important; }
                      .ql-snow .ql-picker { color: #ccc !important; }
                      .ql-editor { font-family: inherit; font-size: 0.95rem; min-height: 80px; }
                      .ql-editor p { margin-bottom: 1em !important; }
                    `}</style>

                    {/* BOUTON SUPPRIMER ÉTAPE (EN HAUT À DROITE) */}
                    <button 
                      onClick={() => setNewStrat({...newStrat, steps: newStrat.steps.filter((_, idx) => idx !== i)})} 
                      style={{ position: "absolute", top: "10px", right: "10px", color: "#444", background: "rgba(0,0,0,0.3)", border: "none", cursor: "pointer", fontSize: "1rem", padding: "5px", borderRadius: "50%", width: "25px", height: "25px", display: "flex", alignItems: "center", justifyContent: "center" }}
                      onMouseEnter={e => e.currentTarget.style.color = "#ff4655"}
                      onMouseLeave={e => e.currentTarget.style.color = "#444"}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL FULLSCREEN STRAT */} 
      {fullscreenStrat && ( 
        <div style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100%", background: "rgba(5, 8, 11, 0.98)", zIndex: 5000, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}> 
          <div style={{ width: "95%", height: "92vh", background: "#0f1923", borderRadius: "15px", border: "2px solid #ff4655", display: "flex", overflow: "hidden" }}> 
            
            {/* COLONNE GAUCHE : TITRE & NOTES (Rectangle Orange) */} 
            <div style={{ 
              width: "400px", 
              flexShrink: 0, 
              background: "rgba(0,0,0,0.4)", 
              borderRight: "2px solid #2a3541", 
              display: "flex", 
              flexDirection: "column", 
              padding: "50px 35px", 
              backdropFilter: "blur(10px)"
            }}> 
              {/* TITRE */} 
              <h2 style={{ 
                color: "#ff4655", 
                fontSize: "2rem", 
                fontWeight: "900", 
                textTransform: "uppercase", 
                margin: 0, 
                overflowWrap: "anywhere", // Force le titre à rester dans le cadre 
                lineHeight: "1.1" 
              }}> 
                {fullscreenStrat.title} 
              </h2> 
            
              {/* SEPARATEUR */} 
              <div style={{ height: "4px", width: "80px", background: "#ff4655", marginTop: "10px" }} /> 
            
              {/* DESCRIPTION (Rectangle Gris/Orange sur ton schéma) */} 
              <div style={{ 
                marginTop: "20px", 
                color: "#eee", 
                fontSize: "1.1rem", 
                lineHeight: "1.7", 
                overflowY: "auto", 
              }} className="nav-no-scrollbar"> 
                <div className="ql-snow"> 
                  <div 
                    className="ql-editor" 
                    style={{ 
                      textAlign: "left", 
                      padding: 0, 
                      color: "#eee", 
                      fontSize: "1.1rem" 
                    }} 
                    dangerouslySetInnerHTML={{ __html: fullscreenStrat.content }} 
                  /> 
                </div> 
              </div> 
            
              {/* BOUTON RETOUR EN BAS */} 
              <div style={{ marginTop: "auto", paddingTop: "30px" }}> 
                <div style={{ display: "flex", gap: "10px", marginBottom: "20px" }}>
                  <span style={{ background: fullscreenStrat.side === "ATK" ? "#ff4655" : "#4ea8de", color: "white", padding: "6px 12px", borderRadius: "4px", fontSize: "0.7rem", fontWeight: "900", letterSpacing: "1px" }}>{fullscreenStrat.side}</span>
                  <span style={{ background: "rgba(255,255,255,0.1)", color: "#aaa", padding: "6px 12px", borderRadius: "4px", fontSize: "0.7rem", fontWeight: "900", letterSpacing: "1px" }}>{fullscreenStrat.tab_name}</span>
                </div>
                <button onClick={() => setFullscreenStrat(null)} style={{ 
                  width: "100%", background: "#ff4655", border: "none", color: "white", 
                  padding: "15px", fontWeight: "900", cursor: "pointer", borderRadius: "4px", 
                  textTransform: "uppercase", letterSpacing: "2px" 
                }}> 
                  RETOUR 
                </button> 
              </div> 

              <style>{` 
                .ql-editor { 
                  white-space: pre-wrap !important; 
                  background: transparent !important;
                  height: auto !important;
                } 
                .ql-editor p { 
                  margin-bottom: 1.5em !important; 
                } 
                .ql-editor .ql-indent-1 { padding-left: 3em !important; } 
                .ql-editor .ql-indent-2 { padding-left: 6em !important; } 
                
                .strategy-content ul, .strategy-content ol { 
                  padding-left: 25px; 
                  margin-bottom: 15px; 
                } 
                .strategy-content li { 
                  margin-bottom: 8px; 
                  list-style-position: outside; 
                } 
              `}</style>
            </div> 
      
            {/* COLONNE DROITE : ÉTAPES (Zone de défilement) */} 
            <div style={{ flex: 1, overflowY: "auto", padding: "40px", background: "#0a0f14" }}> 
              <div style={{ maxWidth: "1200px", margin: "0 auto" }}> 
                {fullscreenStrat.steps?.map((step, idx) => ( 
                  <div key={idx} style={{ marginBottom: "60px", display: "block" }}> 
                    
                    {/* LE CADRE VERT (Conteneur de l'étape - HORIZONTAL) */} 
                    <div 
                      className="cadre-vert" 
                      style={{ 
                        display: 'flex', gap: '40px', alignItems: 'stretch', padding: '30px', 
                        background: 'rgba(255,255,255,0.01)', borderRadius: '20px', 
                        border: '1px solid rgba(255, 70, 85, 0.1)', 
                        boxShadow: '0 15px 40px rgba(0,0,0,0.6)', marginBottom: '10px' 
                      }} 
                    > 
                      {/* CADRE IMAGE QUI POP (Bleu ciel) */} 
                      <div 
                        className="cadre-image-pop" 
                        style={{ 
                          flex: "1.6", 
                          borderRadius: "12px", 
                          overflow: "visible", 
                          transition: "transform 0.4s cubic-bezier(0.165, 0.84, 0.44, 1), box-shadow 0.4s ease", 
                          cursor: "zoom-in", 
                          position: "relative", 
                          zIndex: 1,
                          transform: "translateZ(0)", // Force l'accélération GPU 
                          backfaceVisibility: "hidden", 
                        }} 
                        onMouseEnter={e => { 
                          e.currentTarget.style.transform = "scale(1.25) translateY(-10px)"; 
                          e.currentTarget.style.zIndex = "100"; 
                          e.currentTarget.style.boxShadow = "0 20px 60px rgba(0,0,0,0.8)"; 
                        }} 
                        onMouseLeave={e => { 
                          e.currentTarget.style.transform = "scale(1) translateY(0)"; 
                          e.currentTarget.style.boxShadow = "none"; 
                          // IMPORTANT : On ne remet le zIndex à 1 QUE quand la transition est finie 
                          const target = e.currentTarget; 
                          target.addEventListener('transitionend', () => { 
                            if (target.style.transform === "scale(1) translateY(0px)") { 
                              target.style.zIndex = "1"; 
                            } 
                          }, { once: true }); 
                        }} 
                      > 
                        {/* BADGE NUMÉRO D'ÉTAPE */}
                        <div style={{ 
                          position: 'absolute', 
                          top: '10px', 
                          left: '10px', 
                          background: '#ff4655', 
                          color: 'white', 
                          fontWeight: '900', 
                          fontSize: '0.8rem', 
                          padding: '4px 8px', 
                          borderRadius: '4px', 
                          zIndex: 10 
                        }}>
                          {idx + 1}
                        </div>
                        <img 
                          src={step.img} 
                          style={{ 
                            width: "100%", 
                            height: "auto", 
                            borderRadius: "12px", 
                            display: "block", 
                            pointerEvents: "none", // Évite les conflits de hover entre l'image et la div 
                            boxShadow: "0 10px 30px rgba(0,0,0,0.8)" 
                          }} 
                        /> 
                      </div> 
      
                      {/* TEXTE (Gris) */} 
                      <div style={{ flex: 1 }}> 
                        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                          {(step.contents || (step.text ? [{ id: 'legacy', text: step.text }] : [])).map((content: any, j: number) => (
                            <div 
                              key={content.id || j} 
                              style={{ 
                                position: "relative",
                                background: "rgba(255, 255, 255, 0.03)",
                                border: "1px solid rgba(255, 70, 85, 0.2)",
                                borderLeft: "4px solid #ff4655",
                                padding: "20px",
                                borderRadius: "4px",
                                transition: "all 0.3s ease"
                              }}
                              onMouseEnter={e => {
                                e.currentTarget.style.background = "rgba(255, 255, 255, 0.07)";
                                e.currentTarget.style.borderColor = "rgba(255, 70, 85, 0.5)";
                              }}
                              onMouseLeave={e => {
                                e.currentTarget.style.background = "rgba(255, 255, 255, 0.03)";
                                e.currentTarget.style.borderColor = "rgba(255, 70, 85, 0.2)";
                              }}
                            >
                              <div className="ql-snow">
                                <div 
                                  className="ql-editor" 
                                  style={{ 
                                    padding: 0, 
                                    color: "#ccc", 
                                    fontSize: "1.2rem", 
                                    lineHeight: "1.8" 
                                  }} 
                                  dangerouslySetInnerHTML={{ __html: content.text }} 
                                /> 
                              </div>
                            </div>
                          ))}
                        </div>
                      </div> 
                    </div> 
      
                    {/* FLÈCHE DE FLUX */} 
                    {idx < fullscreenStrat.steps.length - 1 && ( 
                      <div style={{ textAlign: "center", color: "#ff4655", fontSize: "1.5rem", margin: "30px 0", opacity: 0.3, fontWeight: "100" }}>v</div> 
                    )} 
                  </div> 
                ))} 
              </div> 
            </div> 
          </div> 
        </div> 
      )} 

      {/* MODAL CALLOUTS */}
      {showCallouts && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(5, 8, 11, 0.96)", backdropFilter: "blur(20px)", zIndex: 6000, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
          <div style={{ width: "75%", height: "85%", background: "#0f1923", borderRadius: "30px", border: "2px solid #ff4655", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 0 80px rgba(255, 70, 85, 0.2)" }}>
            <div style={{ padding: "30px 40px", borderBottom: "1px solid #2a3541", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ color: "#ff4655", margin: 0, textTransform: "uppercase", fontSize: "2rem", letterSpacing: "4px" }}>CALL OUT : {activeMap?.name}</h2>
              <button onClick={() => setShowCallouts(false)} style={{ background: "#ff4655", color: "white", border: "none", padding: "12px 35px", borderRadius: "8px", cursor: "pointer", fontWeight: "900" }}>FERMER</button>
            </div>
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "40px", overflow: "hidden" }}>
              {activeMap?.callout_url ? (
                  <img src={activeMap.callout_url} style={{ maxHeight: "100%", maxWidth: "100%", objectFit: "contain", borderRadius: "10px" }} />
              ) : (
                  <p style={{ color: "#ff4655", fontSize: "2rem", fontWeight: "900" }}>IMAGE EN ATTENTE</p>
              )}
            </div>
          </div>
        </div>
      )}

      <style>{` 
        .ql-editor p { 
          margin-bottom: 1.5em !important; 
        } 
        .ql-editor .ql-indent-1 { padding-left: 3em !important; } 
        .ql-editor .ql-indent-2 { padding-left: 6em !important; } 
      `}</style>
    </div>
  )
}