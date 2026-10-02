'use client';
import {Button} from '@/components/ui/button';
import {Component,type ReactNode} from 'react';
import styles from './growth-panel.module.css';
/** Contains a render failure (e.g. one malformed stored record) to its own panel instead of unmounting the whole growth tab. */
export class GrowthPanelBoundary extends Component<{label:string;children:ReactNode},{failed:boolean}>{
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true}}
 render(){return this.state.failed?<p role="alert" className={styles.error}>{this.props.label} 화면을 표시하지 못했습니다. 저장된 기록 형식을 확인하세요. 다른 성장 화면은 계속 사용할 수 있습니다. <Button variant="panel" size="fit" type="button" onClick={()=>this.setState({failed:false})}>다시 표시</Button></p>:this.props.children}
}
