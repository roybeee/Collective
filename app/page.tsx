import Workspace from './workspace';
import AuthGate from './auth-gate';
export default function Home(){return <AuthGate><Workspace/></AuthGate>}
