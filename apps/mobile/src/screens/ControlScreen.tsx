import React, { useState, useEffect } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Modal,
  TextInput,
  ScrollView,
} from 'react-native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useDevicesStore } from '../store/devices'
import type { ActiveUser, LocalUser } from '../store/devices'
import type { RootStackParams } from '../navigation'

type Props = NativeStackScreenProps<RootStackParams, 'Control'>
type Nav = NativeStackNavigationProp<RootStackParams>

function UserRow({ user }: { user: ActiveUser }) {
  const isRemote = user.session === 'rdp'
  const isActive = user.state === 'Active'

  return (
    <View style={styles.userRow}>
      <View style={styles.userIcon}>
        <Text style={styles.userIconText}>{isRemote ? '🌐' : '🖥️'}</Text>
      </View>
      <View style={styles.userInfo}>
        <Text style={styles.userName}>{user.name}</Text>
        <Text style={styles.userMeta}>
          {isRemote ? 'Remote Desktop' : 'Локальная сессия'}
          {' · '}
          {user.logonTime}
        </Text>
      </View>
      <View style={[styles.userStateBadge, { backgroundColor: isActive ? '#4ade8022' : '#88888822' }]}>
        <Text style={[styles.userStateText, { color: isActive ? '#4ade80' : '#888' }]}>
          {isActive ? 'Active' : 'Idle'}
        </Text>
      </View>
    </View>
  )
}

function LocalUserRow({ user }: { user: LocalUser }) {
  return (
    <View style={styles.userRow}>
      <View style={styles.userIcon}>
        <Text style={styles.userIconText}>👤</Text>
      </View>
      <View style={styles.userInfo}>
        <Text style={styles.userName}>{user.name}</Text>
        {user.fullName ? (
          <Text style={styles.userMeta}>{user.fullName}</Text>
        ) : null}
      </View>
      <View style={[styles.userStateBadge, { backgroundColor: user.enabled ? '#4ade8022' : '#88888822' }]}>
        <Text style={[styles.userStateText, { color: user.enabled ? '#4ade80' : '#888' }]}>
          {user.enabled ? 'Активен' : 'Отключён'}
        </Text>
      </View>
    </View>
  )
}

interface CommandButtonProps {
  label: string
  emoji: string
  color: string
  onPress: () => void
}

function CommandButton({ label, emoji, color, onPress }: CommandButtonProps) {
  return (
    <TouchableOpacity
      style={[styles.cmdButton, { borderColor: color }]}
      onPress={onPress}
    >
      <Text style={styles.cmdEmoji}>{emoji}</Text>
      <Text style={[styles.cmdLabel, { color }]}>{label}</Text>
    </TouchableOpacity>
  )
}

export default function ControlScreen({ route }: Props) {
  const { deviceId, deviceName } = route.params
  const { sendCommand, devices, localUsers, fetchLocalUsers } = useDevicesStore()
  const navigation = useNavigation<Nav>()
  const device = devices.find((d) => d.id === deviceId)
  const deviceLocalUsers = localUsers[deviceId] ?? []

  useEffect(() => {
    void fetchLocalUsers(deviceId)
  }, [deviceId])

  const [delayModal, setDelayModal] = useState(false)
  const [pendingCommand, setPendingCommand] = useState<string | null>(null)
  const [delaySeconds, setDelaySeconds] = useState('0')

  const executeCommand = async (type: string, delay = 0) => {
    try {
      const result = await sendCommand(deviceId, type, delay)
      Alert.alert(
        result.delivered ? '✓ Команда отправлена' : '⚠ Устройство оффлайн',
        result.delivered
          ? `${type} будет выполнен${delay > 0 ? ` через ${delay} сек` : ''}`
          : 'Команда сохранена и выполнится при подключении'
      )
    } catch {
      Alert.alert('Ошибка', 'Не удалось отправить команду')
    }
  }

  const confirmCommand = (type: string) => {
    Alert.alert(
      'Подтвердите действие',
      `Выполнить ${type} на "${deviceName}"?`,
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'С задержкой',
          onPress: () => {
            setPendingCommand(type)
            setDelayModal(true)
          },
        },
        {
          text: 'Сейчас',
          style: 'destructive',
          onPress: () => void executeCommand(type, 0),
        },
      ]
    )
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Статус */}
      <View style={styles.statusCard}>
        <View style={styles.statusRow}>
          <View
            style={[
              styles.statusDot,
              {
                backgroundColor:
                  device?.status === 'online' ? '#4ade80' :
                  device?.status === 'away'   ? '#facc15' : '#ef4444',
              },
            ]}
          />
          <Text style={styles.statusText}>
            {device?.status ?? 'unknown'}
          </Text>
        </View>

        {device?.status === 'online' && (
          <View style={styles.statsRow}>
            <View style={styles.statBox}>
              <Text style={styles.statVal}>{device.cpuPercent}%</Text>
              <Text style={styles.statLbl}>CPU</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statVal}>{device.ramPercent}%</Text>
              <Text style={styles.statLbl}>RAM</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statVal}>
                {Math.floor((device.uptime ?? 0) / 3600)}h
              </Text>
              <Text style={styles.statLbl}>Uptime</Text>
            </View>
          </View>
        )}
      </View>

      {/* Команды */}
      <Text style={styles.sectionTitle}>Управление</Text>
      <View style={styles.cmdGrid}>
        <CommandButton
          label="Выключить"
          emoji="⏻"
          color="#ef4444"
          onPress={() => confirmCommand('SHUTDOWN')}
        />
        <CommandButton
          label="Перезагрузить"
          emoji="↺"
          color="#f97316"
          onPress={() => confirmCommand('REBOOT')}
        />
        <CommandButton
          label="Заблокировать"
          emoji="🔒"
          color="#6c63ff"
          onPress={() => void executeCommand('LOCK', 0)}
        />
        <CommandButton
          label="Сон"
          emoji="💤"
          color="#22d3ee"
          onPress={() => void executeCommand('SLEEP', 0)}
        />
      </View>

      {/* Пользователи */}
      {device?.status === 'online' && (device?.activeUsers?.length ?? 0) > 0 && (
        <>
          <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Пользователи</Text>
          <View style={styles.usersCard}>
            {device.activeUsers.map((u, i) => (
              <UserRow key={u.name + i} user={u} />
            ))}
          </View>
        </>
      )}

      {/* Учётные записи ПК */}
      {deviceLocalUsers.length > 0 && (
        <>
          <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Учётные записи ПК</Text>
          <View style={styles.usersCard}>
            {deviceLocalUsers.map((u) => (
              <LocalUserRow key={u.id} user={u} />
            ))}
          </View>
        </>
      )}

      {/* Расписание */}
      <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Настройки</Text>
      <TouchableOpacity
        style={styles.scheduleBtn}
        onPress={() => navigation.navigate('Schedule', { deviceId, deviceName })}
      >
        <Text style={styles.scheduleEmoji}>🕐</Text>
        <Text style={styles.scheduleBtnText}>Расписание работы</Text>
        <Text style={styles.scheduleArrow}>›</Text>
      </TouchableOpacity>

      {/* Модалка задержки */}
      <Modal visible={delayModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              Задержка для {pendingCommand}
            </Text>
            <TextInput
              style={styles.modalInput}
              value={delaySeconds}
              onChangeText={setDelaySeconds}
              keyboardType="number-pad"
              placeholder="Секунды"
              placeholderTextColor="#666"
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={() => setDelayModal(false)}
              >
                <Text style={{ color: '#888' }}>Отмена</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalConfirm}
                onPress={() => {
                  setDelayModal(false)
                  if (pendingCommand) {
                    void executeCommand(
                      pendingCommand,
                      parseInt(delaySeconds) || 0
                    )
                  }
                }}
              >
                <Text style={{ color: '#fff' }}>Выполнить</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f23' },
  content: { padding: 16 },
  statusCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#333',
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  statusDot: { width: 12, height: 12, borderRadius: 6 },
  statusText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  statsRow: { flexDirection: 'row', justifyContent: 'space-around' },
  statBox: { alignItems: 'center' },
  statVal: { color: '#6c63ff', fontSize: 20, fontWeight: '700' },
  statLbl: { color: '#666', fontSize: 12, marginTop: 2 },
  sectionTitle: {
    color: '#888',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  cmdGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  cmdButton: {
    width: '47%',
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
  },
  cmdEmoji: { fontSize: 28, marginBottom: 8 },
  cmdLabel: { fontSize: 14, fontWeight: '600' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    padding: 32,
  },
  modalCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: '#333',
  },
  modalTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
  },
  modalInput: {
    backgroundColor: '#0f0f23',
    borderRadius: 8,
    padding: 12,
    color: '#fff',
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#333',
    marginBottom: 16,
  },
  modalButtons: { flexDirection: 'row', gap: 12 },
  modalCancel: {
    flex: 1,
    padding: 12,
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
  },
  modalConfirm: {
    flex: 1,
    padding: 12,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: '#6c63ff',
  },
  scheduleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#333',
    marginBottom: 12,
  },
  scheduleEmoji: { fontSize: 22, marginRight: 12 },
  scheduleBtnText: { flex: 1, color: '#fff', fontSize: 15, fontWeight: '500' },
  scheduleArrow: { color: '#666', fontSize: 22 },
  usersCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#333',
    overflow: 'hidden',
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
    gap: 12,
  },
  userIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#0f0f23',
    alignItems: 'center',
    justifyContent: 'center',
  },
  userIconText: { fontSize: 18 },
  userInfo: { flex: 1 },
  userName: { color: '#fff', fontSize: 14, fontWeight: '600' },
  userMeta: { color: '#666', fontSize: 12, marginTop: 2 },
  userStateBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  userStateText: { fontSize: 12, fontWeight: '600' },
})