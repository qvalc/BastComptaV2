// Use one persistence policy from the first SDK initialization in every frame.
// getAuth() followed by setPersistence() can migrate/remove the other frame's
// persisted user before it is written back, which looks like a real sign-out.
export function initializeV2Auth(app, initializeAuth, persistence) {
  return initializeAuth(app, {persistence});
}

export function terrainSessionUrl(source,base) {
  if(!source)return '';
  const url=new URL(source,base);
  url.searchParams.set('v2Session','local-auth-20261118');
  return url.href;
}

// Firebase emits auth-state changes only when the UID changes. An explicit login
// retry must therefore also be able to retry an earlier portal-loading failure.
export function createPortalSession({currentUser,open,close,onError}) {
  let generation=0,pending=null,readyUid=null;
  function enter(user) {
    if(!user){generation++;pending=null;readyUid=null;close();return Promise.resolve(false);}
    if(pending?.uid===user.uid)return pending.promise;
    if(readyUid===user.uid&&currentUser()?.uid===user.uid)return Promise.resolve(true);
    const ticket=++generation,uid=user.uid;
    const isCurrent=()=>ticket===generation&&currentUser()?.uid===uid;
    const promise=Promise.resolve().then(async()=>{
      if(!isCurrent())return false;
      await open(user,isCurrent);
      if(!isCurrent())return false;
      readyUid=uid;return true;
    }).catch(error=>{if(isCurrent())onError(error);return false;}).finally(()=>{if(pending?.ticket===ticket)pending=null;});
    pending={uid,ticket,promise};return promise;
  }
  return Object.freeze({enter});
}
