package tech.dongdongbh.mindwtr.pilot

import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import tech.dongdongbh.mindwtr.pilot.core.CoreHost
import java.io.File

/** Isolated development shell for validating core startup and storage. */
class MainActivity : ComponentActivity() {
    private var status by mutableStateOf("Loading core…")
    private val hostLock = Any()
    @Volatile private var destroyed = false
    private var host: CoreHost? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                Column(
                    modifier = Modifier.fillMaxSize().padding(24.dp),
                    verticalArrangement = Arrangement.Center,
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    if (status == "Loading core…") CircularProgressIndicator()
                    Text(status, modifier = Modifier.padding(top = 16.dp))
                }
            }
        }
        Thread({
            var runtime: CoreHost? = null
            try {
                runtime = CoreHost(File(filesDir, "mindwtr-native-dev.db"))
                val active = synchronized(hostLock) {
                    if (destroyed) false else { host = runtime; true }
                }
                if (!active) {
                    runtime.close()
                    return@Thread
                }
                val bundle = assets.open("core-host.js").bufferedReader().use { it.readText() }
                val count = runtime.start(bundle).getInt("taskCount")
                runOnUiThread { if (!destroyed) status = "Core ready · $count tasks" }
            } catch (error: Throwable) {
                runCatching { runtime?.close() }
                if (!destroyed) {
                    Log.e(CoreHost.TAG, "Core boot failed", error)
                    val cause = generateSequence(error) { it.cause }.last()
                    runOnUiThread {
                        if (!destroyed) status = "Core failed to load: ${cause.message ?: cause.javaClass.simpleName}"
                    }
                }
            }
        }, "mindwtr-startup").start()
    }

    override fun onDestroy() {
        val runtime = synchronized(hostLock) {
            destroyed = true
            host.also { host = null }
        }
        if (runtime != null) Thread({ runtime.close() }, "mindwtr-shutdown").start()
        super.onDestroy()
    }
}
