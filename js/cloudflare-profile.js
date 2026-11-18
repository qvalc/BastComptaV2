// Firebase identities and subscription reads are retained. Profile writes go to
// a V2-only Cloudflare file, never to the V1 Firestore users collection.
export function cloudProfileAccess(readFirestore) {
  const name = 'bastcompta-v2-account.json';
  function ownReference(ref) {
    const uid=window.BastCloudV2.state.auth?.currentUser?.uid;
    if(!uid || ref.path!==`users/${uid}`)throw new Error('Le profil demandé ne correspond pas au compte V2 connecté.');
  }
  async function getDoc(ref) {
    ownReference(ref);
    const repo = await window.BastCloudV2.ensure();
    const file = repo.files.find(entry=>entry.name===name&&!entry.trashed);
    if(file) {const data=JSON.parse(await(await repo.read(file.id)).text());return {exists:()=>true,data:()=>data};}
    return readFirestore(ref);
  }
  async function setDoc(ref,value,options={}) {
    ownReference(ref);
    const repo=await window.BastCloudV2.ensure();
    const file=repo.files.find(entry=>entry.name===name&&!entry.trashed);
    const existing=options.merge ? await getDoc(ref) : null;
    const data=options.merge ? {...(existing?.exists()?existing.data():{}),...value} : value;
    await repo.write({id:file?.id,metadata:{name,mimeType:'application/json',appProperties:{module:'v2-account'}},content:new Blob([JSON.stringify(data)],{type:'application/json'})});
  }
  return {getDoc,setDoc,updateDoc:(ref,value)=>setDoc(ref,value,{merge:true})};
}
